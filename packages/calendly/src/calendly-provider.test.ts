import { fileURLToPath } from 'node:url';
import {
  InvalidArgumentError,
  NotFoundError,
  type SyncChangeV1,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import { createRecordingFetch } from '@calsdk/provider-tests';
import { afterAll, describe, expect, it } from 'vitest';
import { calendly } from './calendly-provider';

// The 30 minute event type of a test account, and a time it was free when recorded. To
// re-record, set them to an event type and free slot of your account, and run with
// CALSDK_RECORD=1 and CALENDLY_TOKEN set. Booking needs a paid plan. The account must
// have no other active meetings, as a sync reads all of them. Then redact the recording
// with scripts/redact-recording.ts.
const EVENT_TYPE = 'a098fbc8-efdc-4617-919c-5990a514addb';
const SLOT = '2026-11-09T04:30:00Z';

const recording = createRecordingFetch({
  path: fileURLToPath(new URL('../test/fixtures/provider.json', import.meta.url)),
  mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
});
afterAll(() => recording.save());

describe('calendly against the API', () => {
  const provider = calendly({
    accessToken: process.env.CALENDLY_TOKEN ?? 'replay',
    fetch: recording.fetch,
  });
  const calendarId = 'primary';

  it('books, reads, lists, syncs and cancels a meeting', async () => {
    const { nextCursor: initial } = await provider.doSyncEvents({ calendarId });
    const { event, warnings } = await provider.doCreateEvent({
      calendarId,
      event: {
        title: 'Not used',
        // 23:30 in New York is 04:30 UTC.
        start: { dateTime: '2026-11-08T23:30:00-05:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-11-09T00:00:00-05:00', timeZone: 'America/New_York' },
        attendees: [
          { email: 'invitee@example.com', name: 'Test Invitee' },
          { email: 'guest@example.com' },
        ],
      },
      providerOptions: { calendly: { eventType: EVENT_TYPE } },
    });
    try {
      expect(warnings.map((warning) => warning.type === 'unsupported' && warning.feature)).toEqual([
        'title',
      ]);
      // Times are shown in the account's zone. The account hosts the meeting.
      const host = event.organizer?.email;
      expect(host).toContain('@');
      expect(event).toMatchObject({
        calendarId,
        title: '30 Minute Meeting',
        start: { dateTime: '2026-11-09T10:00:00+05:30', timeZone: 'Asia/Calcutta' },
        end: { dateTime: '2026-11-09T10:30:00+05:30', timeZone: 'Asia/Calcutta' },
        status: 'confirmed',
        attendees: [
          { email: host, responseStatus: 'accepted', organizer: true },
          { email: 'invitee@example.com', name: 'Test Invitee', responseStatus: 'accepted' },
          { email: 'guest@example.com', responseStatus: 'needsAction' },
        ],
      });
      expect(Date.parse(event.start.dateTime ?? '')).toBe(Date.parse(SLOT));
      expect((await provider.doGetEvent({ calendarId, eventId: event.id })).event).toEqual(event);

      // Found by its end, half an hour after the window starts.
      const { events } = await provider.doListEvents({
        calendarId,
        timeMin: '2026-11-09T04:45:00Z',
        timeMax: '2026-11-10T00:00:00Z',
        expandRecurring: true,
      });
      const { attendees, ...listed } = event;
      expect(events).toEqual([listed]);

      const synced = await provider.doSyncEvents({ calendarId, cursor: initial });
      expect(synced.changes).toEqual([{ type: 'upsert', event: listed }]);
      const unchanged = await provider.doSyncEvents({ calendarId, cursor: synced.nextCursor });
      expect(unchanged.changes).toEqual([]);

      await provider.doDeleteEvent({
        calendarId,
        eventId: event.id,
        providerOptions: { calendly: { reason: 'calsdk test' } },
      });
      await expect(provider.doGetEvent({ calendarId, eventId: event.id })).rejects.toThrow(
        NotFoundError,
      );
      await expect(provider.doDeleteEvent({ calendarId, eventId: event.id })).rejects.toThrow(
        NotFoundError,
      );
      const deleted = await provider.doSyncEvents({ calendarId, cursor: unchanged.nextCursor });
      expect(deleted.changes).toEqual([{ type: 'delete', eventId: event.id }]);
    } finally {
      // Cancels the meeting if a check failed before the test did.
      await Promise.resolve(provider.doDeleteEvent({ calendarId, eventId: event.id })).catch(
        () => {},
      );
    }
  }, 60_000);
});

describe('calendly with a stubbed API', () => {
  const ME = 'https://api.calendly.com/users/me-uuid';
  const meeting = (uuid: string, start: string, end: string, name = 'Intro') => ({
    uri: `https://api.calendly.com/scheduled_events/${uuid}`,
    name,
    status: 'active',
    start_time: start,
    end_time: end,
    event_type: 'https://api.calendly.com/event_types/type',
    event_memberships: [{ user_email: 'me@example.com', user_name: 'Me' }],
  });

  /** An account holding `meetings`, paged two at a time, with a 30 minute event type. */
  function stub(meetings: ReturnType<typeof meeting>[]) {
    const requests: URL[] = [];
    const provider = calendly({
      accessToken: 'test',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        requests.push(url);
        if (url.pathname === '/users/me') {
          return Response.json({
            resource: { uri: ME, email: 'me@example.com', timezone: 'Europe/London' },
          });
        }
        if (url.pathname === '/event_types/type') {
          return Response.json({
            resource: { uri: 'https://api.calendly.com/event_types/type', duration: 30 },
          });
        }
        if (url.pathname === '/scheduled_events') {
          const offset = Number(url.searchParams.get('page_token') ?? 0);
          const next = offset + 2 < meetings.length ? String(offset + 2) : null;
          return Response.json({
            collection: meetings.slice(offset, offset + 2),
            pagination: { next_page_token: next },
          });
        }
        return Response.json({ title: 'Resource Not Found' }, { status: 404 });
      },
    });
    return { provider, requests };
  }

  it('syncs changed meetings as upserts and meetings no longer active as deletes', async () => {
    const calendarId = 'primary';
    const a = meeting('a', '2030-01-01T10:00:00Z', '2030-01-01T10:30:00Z');
    const b = meeting('b', '2030-01-02T10:00:00Z', '2030-01-02T10:30:00Z');
    const c = meeting('c', '2030-01-03T10:00:00Z', '2030-01-03T10:30:00Z');
    const first = await stub([a, b, c]).provider.doSyncEvents({ calendarId });
    expect(first.changes.map((change) => change.type === 'upsert' && change.event.id)).toEqual([
      'a',
      'b',
      'c',
    ]);

    const moved = { ...b, name: 'Renamed' };
    const second = await stub([a, moved]).provider.doSyncEvents({
      calendarId,
      cursor: first.nextCursor,
    });
    expect(second.changes).toEqual<SyncChangeV1[]>([
      { type: 'upsert', event: expect.objectContaining({ id: 'b', title: 'Renamed' }) },
      { type: 'delete', eventId: 'c' },
    ]);
    await expect(
      stub([]).provider.doSyncEvents({ calendarId, cursor: 'not a cursor' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('lists meetings that end in the window, reading back a day for their start', async () => {
    const { provider, requests } = stub([
      meeting('before', '2030-01-01T09:00:00Z', '2030-01-01T09:30:00Z'),
      meeting('across', '2030-01-01T09:45:00Z', '2030-01-01T10:15:00Z'),
    ]);
    const { events, nextPageToken } = await provider.doListEvents({
      calendarId: 'primary',
      timeMin: '2030-01-01T10:00:00Z',
      timeMax: '2030-01-02T00:00:00Z',
      expandRecurring: true,
    });
    expect(events.map((event) => event.id)).toEqual(['across']);
    expect(events[0]?.start).toEqual({
      dateTime: '2030-01-01T09:45:00+00:00',
      timeZone: 'Europe/London',
    });
    expect(nextPageToken).toBeUndefined();
    const query = Object.fromEntries(requests.at(-1)?.searchParams ?? []);
    expect(query).toMatchObject({
      user: ME,
      status: 'active',
      min_start_time: '2029-12-31T10:00:00.000Z',
      max_start_time: '2030-01-02T00:00:00.000Z',
    });
  });

  it('only books the length of the event type, and cannot move meetings', async () => {
    const { provider } = stub([]);
    const event = {
      start: { dateTime: '2030-01-01T10:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2030-01-01T11:00:00Z', timeZone: 'UTC' },
    };
    await expect(provider.doCreateEvent({ calendarId: 'primary', event })).rejects.toThrow(
      InvalidArgumentError,
    );
    await expect(
      provider.doCreateEvent({
        calendarId: 'primary',
        event,
        providerOptions: { calendly: { eventType: 'type' } },
      }),
    ).rejects.toThrow('books 30 minute meetings, not 60 minutes');
    await expect(
      provider.doCreateEvent({
        calendarId: 'primary',
        event,
        providerOptions: { calendly: { eventType: 'missing' } },
      }),
    ).rejects.toThrow('Calendly has no event type "missing".');
    await expect(
      provider.doUpdateEvent({ calendarId: 'primary', eventId: 'a', patch: {} }),
    ).rejects.toThrow(UnsupportedFunctionalityError);
    await expect(provider.doGetEvent({ calendarId: 'type', eventId: 'a' })).rejects.toThrow(
      NotFoundError,
    );
  });
});
