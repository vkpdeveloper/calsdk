import { fileURLToPath } from 'node:url';
import {
  InvalidArgumentError,
  NotFoundError,
  type SyncChangeV1,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import { createRecordingFetch } from '@calsdk/provider-tests';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Meeting, Occurrence } from './zoom-api';
import { zoom } from './zoom-provider';

const recording = createRecordingFetch({
  path: fileURLToPath(new URL('../test/fixtures/provider.json', import.meta.url)),
  mode: process.env.CALSDK_RECORD ? 'record' : 'replay',
});
afterAll(() => recording.save());

// To re-record, run with CALSDK_RECORD=1 and ZOOM_TOKEN set, then redact the recording
// with scripts/redact-recording.ts.
describe('zoom against the API', () => {
  const provider = zoom({
    accessToken: process.env.ZOOM_TOKEN ?? 'replay',
    fetch: recording.fetch,
  });
  const calendarId = 'primary';
  const NY = 'America/New_York';
  // Mondays 11, 18 and 25 January 2027, at 10:00 in New York. Zoom schedules no meetings
  // of series that start years ahead.
  const at = (day: number, hour: number, minute = 0) => ({
    dateTime: `2027-01-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-05:00`,
    timeZone: NY,
  });
  const ids = (events: { id: string }[]) => events.map((event) => event.id);

  it('creates a series, changes and deletes single meetings of it, and deletes it', async () => {
    const { event: series, warnings } = await provider.doCreateEvent({
      calendarId,
      event: {
        title: 'calsdk series',
        description: 'Weekly',
        start: at(11, 10),
        end: at(11, 10, 30),
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3'],
        attendees: [{ email: 'invitee@example.com' }],
      },
    });
    try {
      expect(warnings).toEqual([]);
      const host = series.organizer?.email;
      expect(host).toContain('@');
      expect(series).toMatchObject({
        kind: 'series',
        title: 'calsdk series',
        description: 'Weekly',
        start: at(11, 10),
        end: at(11, 10, 30),
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO'],
        attendees: [
          { email: host, responseStatus: 'accepted', organizer: true },
          { email: 'invitee@example.com', responseStatus: 'needsAction' },
        ],
        conference: { provider: 'zoom', id: series.id },
      });

      const window = {
        calendarId,
        timeMin: '2027-01-11T00:00:00Z',
        timeMax: '2027-02-01T00:00:00Z',
      };
      const listed = await provider.doListEvents({ ...window, expandRecurring: true });
      const ours = listed.events.filter((event) => event.seriesId === series.id);
      expect(ids(ours)).toEqual([11, 18, 25].map((day) => `${series.id}_202701${day}T150000Z`));
      expect(ours.map((event) => event.kind)).toEqual(['occurrence', 'occurrence', 'occurrence']);
      const [first, second, third] = ours;
      if (!first || !second || !third) throw new Error('Expected three meetings.');
      expect(second.originalStart).toEqual(at(18, 10));

      // One meeting moves an hour later and gets longer.
      const moved = await provider.doUpdateEvent({
        calendarId,
        eventId: second.id,
        patch: { start: at(18, 11), end: at(18, 12) },
      });
      expect(moved.event).toMatchObject({
        id: second.id,
        kind: 'exception',
        seriesId: series.id,
        start: at(18, 11),
        end: at(18, 12),
        originalStart: at(18, 10),
      });
      await provider.doDeleteEvent({ calendarId, eventId: third.id });
      await expect(provider.doGetEvent({ calendarId, eventId: third.id })).rejects.toThrow(
        NotFoundError,
      );
      await expect(provider.doDeleteEvent({ calendarId, eventId: third.id })).rejects.toThrow(
        NotFoundError,
      );
      const master = (await provider.doGetEvent({ calendarId, eventId: series.id })).event;
      expect(master.recurrence).toEqual([
        'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO',
        'EXDATE:20270125T150000Z',
      ]);
      const after = await provider.doListEvents({ ...window, expandRecurring: true });
      expect(
        after.events
          .filter((event) => event.seriesId === series.id)
          .map((event) => [event.id, event.kind]),
      ).toEqual([
        [first.id, 'occurrence'],
        [second.id, 'exception'],
      ]);

      // Renaming takes the whole series.
      const renamed = await provider.doUpdateEvent({
        calendarId,
        eventId: first.id,
        scope: 'all',
        patch: { title: 'calsdk series (renamed)' },
      });
      expect(renamed.event).toMatchObject({ id: series.id, title: 'calsdk series (renamed)' });
      const exception = (await provider.doGetEvent({ calendarId, eventId: second.id })).event;
      expect(exception).toMatchObject({ title: 'calsdk series (renamed)', start: at(18, 11) });

      // Moving the series an hour later schedules every meeting anew, the moved and the
      // deleted one too.
      const later = await provider.doUpdateEvent({
        calendarId,
        eventId: first.id,
        scope: 'all',
        patch: { start: at(11, 11), end: at(11, 11, 30) },
      });
      expect(later.warnings).toEqual([expect.objectContaining({ type: 'other' })]);
      expect(later.event).toMatchObject({
        start: at(11, 11),
        end: at(11, 11, 30),
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO'],
      });
      const restored = await provider.doListEvents({ ...window, expandRecurring: true });
      expect(
        restored.events
          .filter((event) => event.seriesId === series.id)
          .map((event) => [event.id, event.kind]),
      ).toEqual([11, 18, 25].map((day) => [`${series.id}_202701${day}T160000Z`, 'occurrence']));

      await provider.doDeleteEvent({ calendarId, eventId: series.id, scope: 'all' });
      await expect(provider.doGetEvent({ calendarId, eventId: series.id })).rejects.toThrow(
        NotFoundError,
      );
    } finally {
      // Deletes the series if a check failed before the test did.
      await Promise.resolve(provider.doDeleteEvent({ calendarId, eventId: series.id })).catch(
        () => {},
      );
    }
  }, 60_000);
});

const ZONE = 'Europe/London';
const single = (id: number, start: string, topic = 'Intro'): Meeting => ({
  id,
  type: 2,
  topic,
  start_time: start,
  duration: 30,
  timezone: ZONE,
  join_url: `https://zoom.us/j/${id}`,
});
/** A daily series of three meetings from 1 January 2030 at 10:00 UTC. */
const series = (id: number, changes: Record<number, Partial<Occurrence>> = {}): Meeting => ({
  id,
  type: 8,
  topic: 'Standup',
  // Zoom keeps the times of a series on its occurrences only.
  start_time: null,
  duration: null,
  timezone: ZONE,
  recurrence: { type: 1, repeat_interval: 1, end_times: 3 },
  occurrences: [0, 1, 2].map((day) => {
    const start = Date.UTC(2030, 0, 1 + day, 10);
    return {
      occurrence_id: String(start),
      start_time: new Date(start).toISOString().replace('.000', ''),
      duration: 15,
      status: 'available',
      ...changes[day],
    };
  }),
});

/** An account holding `meetings`, listed two to a page as Zoom lists them. */
function stub(meetings: Meeting[]) {
  const requests: Request[] = [];
  const provider = zoom({
    accessToken: 'test',
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      if (url.pathname === '/v2/users/me/meetings' && request.method === 'POST') {
        // A series this far ahead, which Zoom has not scheduled.
        const created: Meeting = { id: 99, type: 8, occurrences: [] };
        meetings.push(created);
        return Response.json(created, { status: 201 });
      }
      if (url.pathname === '/v2/users/me/meetings') {
        const offset = Number(url.searchParams.get('next_page_token') || 0);
        return Response.json({
          // Listings leave out occurrences and invitees.
          meetings: meetings
            .slice(offset, offset + 2)
            .map(({ occurrences, settings, ...meeting }) => meeting),
          next_page_token: offset + 2 < meetings.length ? String(offset + 2) : '',
        });
      }
      const meeting = meetings.find(({ id }) => url.pathname === `/v2/meetings/${id}`);
      if (meeting && request.method === 'GET') return Response.json(meeting);
      if (meeting) return new Response(null, { status: 204 });
      return Response.json({ code: 3001, message: 'Meeting does not exist' }, { status: 404 });
    },
  });
  return { provider, requests };
}

const calendarId = 'primary';

describe('zoom with a stubbed API', () => {
  afterEach(() => vi.useRealTimers());

  it('expands series into occurrences and exceptions, and pages in start order', async () => {
    const moved = series(2, {
      0: { duration: 45 },
      1: { start_time: '2030-01-02T11:00:00Z' },
      2: { status: 'deleted' },
    });
    const { provider } = stub([
      single(1, '2030-01-01T09:00:00Z'),
      moved,
      single(3, '2030-01-05T09:00:00Z'),
    ]);
    const range = { calendarId, timeMin: '2030-01-01T00:00:00Z', timeMax: '2030-01-04T00:00:00Z' };

    const first = await provider.doListEvents({ ...range, expandRecurring: true, pageSize: 2 });
    const second = await provider.doListEvents({
      ...range,
      expandRecurring: true,
      pageToken: first.nextPageToken,
    });
    expect(second.nextPageToken).toBeUndefined();
    expect([...first.events, ...second.events].map((event) => [event.id, event.kind])).toEqual([
      ['1', 'single'],
      ['2_20300101T100000Z', 'exception'],
      ['2_20300102T100000Z', 'exception'],
    ]);
    expect(first.events[1]?.end).toEqual({ dateTime: '2030-01-01T10:45:00+00:00', timeZone: ZONE });
    expect(second.events[0]).toMatchObject({
      seriesId: '2',
      start: { dateTime: '2030-01-02T11:00:00+00:00', timeZone: ZONE },
      originalStart: { dateTime: '2030-01-02T10:00:00+00:00', timeZone: ZONE },
    });

    const masters = await provider.doListEvents({ ...range, expandRecurring: false });
    expect(masters.events.map((event) => [event.id, event.kind])).toEqual([
      ['1', 'single'],
      ['2', 'series'],
    ]);
    // The series keeps the length most of its meetings have.
    expect(masters.events[1]?.end).toEqual({
      dateTime: '2030-01-01T10:15:00+00:00',
      timeZone: ZONE,
    });
    expect(masters.events[1]?.recurrence).toEqual([
      'RRULE:FREQ=DAILY;COUNT=3',
      'EXDATE:20300103T100000Z',
    ]);
  });

  it('reads and deletes single occurrences, and reads deleted ones as missing', async () => {
    const { provider, requests } = stub([series(2, { 2: { status: 'deleted' } })]);
    const { event } = await provider.doGetEvent({ calendarId, eventId: '2_20300102T100000Z' });
    expect(event).toMatchObject({ kind: 'occurrence', title: 'Standup' });

    await provider.doDeleteEvent({ calendarId, eventId: event.id });
    const deleted = requests.at(-1);
    expect(deleted?.method).toBe('DELETE');
    expect(new URL(deleted?.url ?? '').searchParams.get('occurrence_id')).toBe(
      String(Date.UTC(2030, 0, 2, 10)),
    );
    for (const eventId of ['2_20300103T100000Z', '2_20300104T100000Z', '9']) {
      await expect(provider.doGetEvent({ calendarId, eventId })).rejects.toThrow(NotFoundError);
      await expect(provider.doDeleteEvent({ calendarId, eventId })).rejects.toThrow(NotFoundError);
    }
  });

  it('only moves or resizes one occurrence, and moves a series by as much', async () => {
    const { provider, requests } = stub([series(2, { 2: { status: 'deleted' } })]);
    const eventId = '2_20300102T100000Z';
    await expect(
      provider.doUpdateEvent({ calendarId, eventId, patch: { title: 'Renamed' } }),
    ).rejects.toThrow(UnsupportedFunctionalityError);

    await provider.doUpdateEvent({
      calendarId,
      eventId,
      patch: {
        start: { dateTime: '2030-01-02T12:00:00+00:00', timeZone: ZONE },
        end: { dateTime: '2030-01-02T12:30:00+00:00', timeZone: ZONE },
      },
    });
    const occurrence = requests.find((request) => request.method === 'PATCH');
    expect(new URL(occurrence?.url ?? '').searchParams.get('occurrence_id')).toBe(
      String(Date.UTC(2030, 0, 2, 10)),
    );
    expect(await occurrence?.json()).toEqual({ start_time: '2030-01-02T12:00:00Z', duration: 30 });

    requests.length = 0;
    const { warnings } = await provider.doUpdateEvent({
      calendarId,
      eventId,
      scope: 'all',
      patch: {
        title: 'Later standup',
        start: { dateTime: '2030-01-02T11:00:00+00:00', timeZone: ZONE },
        end: { dateTime: '2030-01-02T11:15:00+00:00', timeZone: ZONE },
      },
    });
    const whole = requests.find((request) => request.method === 'PATCH');
    expect(new URL(whole?.url ?? '').search).toBe('');
    expect(await whole?.json()).toEqual({
      topic: 'Later standup',
      start_time: '2030-01-01T11:00:00Z',
      duration: 15,
      timezone: ZONE,
      type: 8,
      recurrence: { type: 1, repeat_interval: 1, end_times: 3 },
    });
    // Zoom brings back the deleted meeting.
    expect(warnings).toEqual([expect.objectContaining({ type: 'other' })]);
  });

  it('syncs changes, deletes, and drops meetings Zoom stops listing once they end', async () => {
    vi.useFakeTimers({ now: Date.parse('2030-01-01T12:00:00Z'), toFake: ['Date'] });
    const past = single(1, '2030-01-01T09:00:00Z');
    const upcoming = single(3, '2030-01-05T09:00:00Z');
    const moved = series(2, { 1: { start_time: '2030-01-02T11:00:00Z' } });
    const first = await stub([past, moved, upcoming]).provider.doSyncEvents({ calendarId });
    expect(first.changes.map((change) => change.type === 'upsert' && change.event.id)).toEqual([
      '1',
      '2',
      '2_20300102T100000Z',
      '3',
    ]);

    // The exception was moved back, and both single meetings are gone.
    const second = await stub([series(2)]).provider.doSyncEvents({
      calendarId,
      cursor: first.nextCursor,
    });
    expect(second.changes).toEqual<SyncChangeV1[]>([
      {
        type: 'upsert',
        event: expect.objectContaining({ id: '2_20300102T100000Z', kind: 'occurrence' }),
      },
      { type: 'delete', eventId: '3' },
    ]);
    const quiet = await stub([series(2)]).provider.doSyncEvents({
      calendarId,
      cursor: second.nextCursor,
    });
    expect(quiet.changes).toEqual([]);
    await expect(
      stub([]).provider.doSyncEvents({ calendarId, cursor: 'not a cursor' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('creates whole-minute meetings and rejects other lengths', async () => {
    const { provider } = stub([]);
    const event = {
      start: { dateTime: '2030-01-01T10:00:00Z', timeZone: ZONE },
      end: { dateTime: '2030-01-01T10:00:30Z', timeZone: ZONE },
    };
    await expect(provider.doCreateEvent({ calendarId, event })).rejects.toThrow(
      'Zoom meetings last whole minutes',
    );
    await expect(
      provider.doCreateEvent({
        calendarId,
        event: { start: { date: '2030-01-01' }, end: { date: '2030-01-02' } },
      }),
    ).rejects.toThrow(UnsupportedFunctionalityError);
    await expect(provider.doGetEvent({ calendarId: 'other', eventId: '1' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('deletes a series Zoom does not schedule, as it starts too far ahead', async () => {
    const { provider, requests } = stub([]);
    await expect(
      provider.doCreateEvent({
        calendarId,
        event: {
          start: { dateTime: '2040-01-01T10:00:00Z', timeZone: ZONE },
          end: { dateTime: '2040-01-01T10:30:00Z', timeZone: ZONE },
          recurrence: ['RRULE:FREQ=DAILY;COUNT=3'],
        },
      }),
    ).rejects.toThrow(UnsupportedFunctionalityError);
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(
      ['POST /v2/users/me/meetings', 'DELETE /v2/meetings/99'],
    );
  });
});
