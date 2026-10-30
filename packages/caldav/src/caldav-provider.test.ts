import { fileURLToPath } from 'node:url';
import {
  APICallError,
  type EventV1,
  type SyncChangeV1,
  SyncCursorExpiredError,
} from '@calsdk/provider';
import { createRecordingFetch } from '@calsdk/provider-tests';
import type { FetchFunction } from '@calsdk/provider-utils';
import { afterAll, describe, expect, it } from 'vitest';
import { pinWrites } from '../test/pin-writes';
import { caldav } from './caldav-provider';
import { encodeToken } from './tokens';

// Recorded like conformance.test.ts, against the same local Radicale calendar.
const recording = createRecordingFetch({
  path: fileURLToPath(new URL('../test/fixtures/provider.json', import.meta.url)),
  mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
});
afterAll(() => recording.save());
pinWrites();

const calendarId = '/test/calsdk/';
const provider = caldav({
  serverUrl: 'http://localhost:5232/',
  username: 'test',
  password: 'test',
  fetch: recording.fetch,
});
const at = (day: number, hour: number) => ({
  dateTime: `2030-03-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`,
  timeZone: 'UTC',
});

async function withSeries(test: (series: EventV1) => Promise<void>) {
  const { event } = await provider.doCreateEvent({
    calendarId,
    event: {
      title: 'series',
      start: at(4, 10),
      end: at(4, 11),
      recurrence: ['RRULE:FREQ=DAILY;COUNT=3'],
    },
  });
  try {
    await test(event);
  } finally {
    await provider.doDeleteEvent({ calendarId, eventId: event.id, scope: 'all' });
  }
}

const listMarch = async () =>
  (
    await provider.doListEvents({
      calendarId,
      timeMin: '2030-03-01T00:00:00Z',
      timeMax: '2030-04-01T00:00:00Z',
      expandRecurring: true,
    })
  ).events;

describe('caldav provider', () => {
  it('moves a whole series through one instance and drops exceptions it no longer has', () =>
    withSeries(async (series) => {
      const [first, second] = await listMarch();
      if (!first || !second) throw new Error('Expected three occurrences.');
      await provider.doUpdateEvent({
        calendarId,
        eventId: first.id,
        patch: { title: 'moved once' },
      });

      const { event } = await provider.doUpdateEvent({
        calendarId,
        eventId: second.id,
        patch: { start: at(5, 12), end: at(5, 13) },
        scope: 'all',
      });
      expect(event).toMatchObject({ id: series.id, kind: 'series' });

      const after = await listMarch();
      expect(after.map((item) => [item.kind, item.title, item.start.dateTime])).toEqual([
        ['occurrence', 'series', '2030-03-04T12:00:00+00:00'],
        ['occurrence', 'series', '2030-03-05T12:00:00+00:00'],
        ['occurrence', 'series', '2030-03-06T12:00:00+00:00'],
      ]);
    }));

  it('syncs an instance deleted from a series as a delete of its exception', () =>
    withSeries(async (series) => {
      const [, second] = await listMarch();
      if (!second) throw new Error('Expected three occurrences.');
      await provider.doUpdateEvent({
        calendarId,
        eventId: second.id,
        patch: { title: 'exception' },
      });
      const ours = (changes: SyncChangeV1[]) =>
        changes.filter((change) =>
          (change.type === 'upsert' ? change.event.id : change.eventId).startsWith(series.id),
        );
      const initial = await provider.doSyncEvents({ calendarId });
      // An initial sync has nothing to delete, also when the server lists old deletions.
      expect(initial.changes.filter((change) => change.type === 'delete')).toEqual([]);
      expect(
        ours(initial.changes).map((change) => change.type === 'upsert' && change.event.kind),
      ).toEqual(['series', 'exception']);

      await provider.doDeleteEvent({ calendarId, eventId: second.id });
      const next = await provider.doSyncEvents({ calendarId, cursor: initial.nextCursor });
      expect(ours(next.changes)).toEqual([
        { type: 'delete', eventId: second.id },
        { type: 'upsert', event: expect.objectContaining({ id: series.id }) },
      ]);
    }));

  it('rejects a sync cursor the server no longer knows', async () => {
    const cursor = encodeToken({
      syncToken: `http://radicale.org/ns/sync/${'0'.repeat(64)}`,
      exceptions: [],
    });
    await expect(provider.doSyncEvents({ calendarId, cursor })).rejects.toSatisfy(
      SyncCursorExpiredError.isInstance,
    );
  });
});

describe('caldav credentials', () => {
  // A server that keeps calendars on a host of its own, like iCloud.
  const multistatus = (body: string) =>
    new Response(
      `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${body}</D:multistatus>`,
      {
        status: 207,
        headers: { 'content-type': 'application/xml' },
      },
    );
  const response = (href: string, props: string) =>
    `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;

  function server(home: string) {
    const requests: { url: string; authorization: string | null }[] = [];
    const fetch: FetchFunction = async (input, init) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, authorization: request.headers.get('authorization') });
      const { pathname } = new URL(request.url);
      if (pathname === '/') {
        return multistatus(
          response(
            '/',
            '<D:current-user-principal><D:href>/1/principal/</D:href></D:current-user-principal>',
          ),
        );
      }
      if (pathname === '/1/principal/') {
        return multistatus(
          response(
            '/1/principal/',
            `<C:calendar-home-set><D:href>${home}</D:href></C:calendar-home-set>`,
          ),
        );
      }
      if (pathname === '/1/calendars/') {
        return multistatus(
          response(
            '/1/calendars/home/',
            '<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>',
          ),
        );
      }
      return new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.example.net/stolen.ics' },
      });
    };
    const provider = caldav({
      serverUrl: 'https://caldav.example.com/',
      username: 'me',
      password: 'secret',
      fetch,
    });
    return { provider, requests };
  }

  it('sends them to the calendar host discovery finds, and never through a redirect elsewhere', async () => {
    const { provider, requests } = server('https://p01-caldav.example.com/1/calendars/');
    await expect(
      provider.doGetEvent({ calendarId: 'primary', eventId: 'event' }),
    ).rejects.toSatisfy(APICallError.isInstance);

    expect(requests.map((request) => new URL(request.url).host)).toEqual([
      'caldav.example.com',
      'caldav.example.com',
      'p01-caldav.example.com',
      'p01-caldav.example.com',
    ]);
    for (const request of requests) expect(request.authorization).toMatch(/^Basic /);
  });

  it('does not send them to a calendar home on another host over plain HTTP', async () => {
    const { provider, requests } = server('http://p01-caldav.example.com/1/calendars/');
    await expect(provider.doListCalendars({})).rejects.toSatisfy(APICallError.isInstance);
    expect(requests.map((request) => new URL(request.url).host)).toEqual([
      'caldav.example.com',
      'caldav.example.com',
    ]);
  });
});
