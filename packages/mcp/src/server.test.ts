import { mockCalendar } from '@cal-sdk/mock';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { accountsFromEnv } from './accounts';
import { refreshingToken } from './refreshing-token';
import { createCalendarServer } from './server';

const start = { dateTime: '2026-11-09T10:00:00Z', timeZone: 'UTC' };
const end = { dateTime: '2026-11-09T11:00:00Z', timeZone: 'UTC' };

async function connect() {
  const server = createCalendarServer({
    work: mockCalendar({
      calendars: [{ id: 'work' }],
      events: [{ title: 'Standup', start, end }],
    }),
    home: mockCalendar({
      calendars: [{ id: 'home' }],
      events: [
        {
          title: 'Dentist',
          start: { dateTime: '2026-11-09T12:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-11-09T13:00:00Z', timeZone: 'UTC' },
        },
      ],
    }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const [content] = result.content as { type: string; text: string }[];
    return { isError: result.isError ?? false, text: content?.text ?? '' };
  };
}

describe('createCalendarServer', () => {
  it('creates an event on the chosen account and lists it back', async () => {
    const call = await connect();
    const created = await call('create_event', {
      account: 'home',
      event: { title: 'Call mom', start, end },
    });
    expect(created.isError).toBe(false);

    const listed = await call('list_events', {
      account: 'home',
      timeMin: '2026-11-09',
      timeMax: '2026-11-10',
    });
    const titles = JSON.parse(listed.text).events.map((event: { title: string }) => event.title);
    expect(titles).toEqual(['Call mom', 'Dentist']);
  });

  it('finds free time across every account by default', async () => {
    const call = await connect();
    const { text } = await call('find_free_time', {
      timeMin: '2026-11-09T09:00:00Z',
      timeMax: '2026-11-09T14:00:00Z',
      duration: 60,
      slotInterval: 60,
    });
    expect(JSON.parse(text).slots).toEqual([
      { start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T10:00:00.000Z' },
      { start: '2026-11-09T11:00:00.000Z', end: '2026-11-09T12:00:00.000Z' },
      { start: '2026-11-09T13:00:00.000Z', end: '2026-11-09T14:00:00.000Z' },
    ]);
  });

  it('rejects an empty calendar list instead of calling every slot free', async () => {
    const call = await connect();
    const window = { timeMin: '2026-11-09T09:00:00Z', timeMax: '2026-11-09T14:00:00Z' };
    const noCalendars = await call('find_free_time', { ...window, duration: 60, calendars: [] });
    expect(noCalendars.isError).toBe(true);
    const noIds = await call('find_free_time', {
      ...window,
      duration: 60,
      calendars: [{ account: 'work', calendarIds: [] }],
    });
    expect(noIds.isError).toBe(true);
  });

  it('refuses a free-time window too long to search', async () => {
    const call = await connect();
    const result = await call('find_free_time', {
      timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2036-01-01T00:00:00Z',
      duration: 30,
      slotInterval: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/at most 92 days/);
  });

  it('reports calendar errors to the model instead of crashing', async () => {
    const call = await connect();
    const result = await call('delete_event', { eventId: 'missing' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/);
  });
});

describe('refreshingToken', () => {
  it('refreshes once for concurrent calls and reuses the token until it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const grants: (string | null)[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      grants.push(new URLSearchParams(String(init?.body)).get('refresh_token'));
      return Response.json({
        access_token: `token-${grants.length}`,
        expires_in: 3600,
        refresh_token: 'rotated',
      });
    });
    const token = refreshingToken({
      tokenUrl: 'https://auth.example/token',
      clientId: 'client',
      refreshToken: 'original',
      fetch,
    });

    expect(await Promise.all([token(), token()])).toEqual(['token-1', 'token-1']);
    expect(await token()).toBe('token-1');
    expect(fetch).toHaveBeenCalledTimes(1);

    // Tokens are renewed a minute before they expire, with the rotated refresh token.
    vi.advanceTimersByTime(3600_000 - 60_000);
    expect(await token()).toBe('token-2');
    expect(grants).toEqual(['original', 'rotated']);
  });

  it('includes the provider error in the message', async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        { error: 'invalid_grant', error_description: 'Token revoked' },
        { status: 400 },
      ),
    );
    const token = refreshingToken({
      tokenUrl: 'https://auth.example/token',
      clientId: 'client',
      refreshToken: 'revoked',
      fetch,
    });
    await expect(token()).rejects.toThrow('Token revoked');
  });
});

describe('accountsFromEnv', () => {
  it('treats an empty access token as unset and falls back to the refresh token', () => {
    const accounts = accountsFromEnv({
      GOOGLE_ACCESS_TOKEN: '',
      GOOGLE_REFRESH_TOKEN: 'refresh',
      GOOGLE_CLIENT_ID: 'client',
    });
    expect(Object.keys(accounts)).toEqual(['google']);
  });
});
