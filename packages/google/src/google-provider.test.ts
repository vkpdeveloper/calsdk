import {
  InvalidArgumentError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  SyncCursorExpiredError,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { google } from './google-provider';

type Route = {
  method: string;
  path: RegExp;
  respond: (request: Request) => Response | Promise<Response>;
};

/** A fake Google API: each request goes to the first matching route. */
function fakeGoogle(routes: Route[]) {
  const requests: { method: string; url: URL; body: unknown; headers: Headers }[] = [];
  const calendar = google({
    accessToken: 'token',
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const text = await request.clone().text();
      requests.push({
        method: request.method,
        url,
        body: text ? JSON.parse(text) : undefined,
        headers: request.headers,
      });
      const route = routes.find(
        (candidate) =>
          candidate.method === request.method &&
          candidate.path.test(url.pathname.replace('/calendar/v3', '')),
      );
      if (!route) throw new Error(`Unexpected ${request.method} ${url.pathname}`);
      return route.respond(request);
    },
  });
  return { calendar, requests };
}

const googleError = (status: number, reason?: string) =>
  Response.json(
    { error: { code: status, message: 'stubbed', errors: reason ? [{ reason }] : [] } },
    { status },
  );

const series = {
  id: 'series1',
  etag: '"m1"',
  summary: 'Standup',
  start: { dateTime: '2026-11-02T10:00:00-05:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-11-02T10:15:00-05:00', timeZone: 'America/New_York' },
  recurrence: ['RRULE:FREQ=DAILY;COUNT=5', 'EXDATE;TZID=America/New_York:20261105T100000'],
  conferenceData: {
    conferenceId: 'abc-defg-hij',
    entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }],
  },
  attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }],
};
const instance = (day: number, extra = {}) => ({
  id: `series1_202611${String(day).padStart(2, '0')}T150000Z`,
  etag: `"i${day}"`,
  summary: 'Standup',
  recurringEventId: 'series1',
  originalStartTime: {
    dateTime: `2026-11-${String(day).padStart(2, '0')}T10:00:00-05:00`,
    timeZone: 'America/New_York',
  },
  start: {
    dateTime: `2026-11-${String(day).padStart(2, '0')}T10:00:00-05:00`,
    timeZone: 'America/New_York',
  },
  end: {
    dateTime: `2026-11-${String(day).padStart(2, '0')}T10:15:00-05:00`,
    timeZone: 'America/New_York',
  },
  ...extra,
});

describe('google', () => {
  it('converts events, using the calendar zone when an event has none', async () => {
    const { calendar } = fakeGoogle([
      {
        method: 'GET',
        path: /^\/calendars\/primary\/events$/,
        respond: () =>
          Response.json({
            timeZone: 'Asia/Kolkata',
            items: [
              {
                id: 'e1',
                summary: 'Review',
                status: 'tentative',
                start: { dateTime: '2026-11-03T04:30:00Z' },
                end: { dateTime: '2026-11-03T05:30:00Z' },
                transparency: 'transparent',
                visibility: 'confidential',
                colorId: '11',
                hangoutLink: 'https://meet.google.com/xyz',
                reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
                organizer: { email: 'me@example.com', self: true },
              },
            ],
          }),
      },
    ]);
    const { events } = await calendar.doListEvents({
      calendarId: 'primary',
      timeMin: '2026-11-03T00:00:00Z',
      timeMax: '2026-11-04T00:00:00Z',
      expandRecurring: true,
    });
    expect(events[0]).toMatchObject({
      kind: 'single',
      start: { dateTime: '2026-11-03T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
      status: 'tentative',
      showAs: 'free',
      visibility: 'private',
      color: '#d50000',
      conference: { provider: 'google-meet', joinUrl: 'https://meet.google.com/xyz' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutesBefore: 10 }] },
      organizer: { email: 'me@example.com', self: true },
    });
  });

  it('tells modified instances from plain occurrences', async () => {
    const { calendar, requests } = fakeGoogle([
      {
        method: 'GET',
        path: /^\/calendars\/primary\/events$/,
        respond: (request) =>
          new URL(request.url).searchParams.get('singleEvents') === 'true'
            ? Response.json({ items: [instance(2), instance(3, { summary: 'Moved' })] })
            : // Unexpanded: the master, the modified instance, and a deleted one.
              Response.json({
                items: [
                  series,
                  instance(3, { summary: 'Moved' }),
                  instance(5, { status: 'cancelled' }),
                ],
              }),
      },
    ]);
    const { events } = await calendar.doListEvents({
      calendarId: 'primary',
      timeMin: '2026-11-01T00:00:00Z',
      timeMax: '2026-11-08T00:00:00Z',
      expandRecurring: true,
    });
    expect(events.map((event) => [event.kind, event.seriesId])).toEqual([
      ['occurrence', 'series1'],
      ['exception', 'series1'],
    ]);
    expect(requests).toHaveLength(2);
  });

  it('only returns singles and masters when not expanding', async () => {
    const { calendar } = fakeGoogle([
      {
        method: 'GET',
        path: /^\/calendars\/primary\/events$/,
        respond: () =>
          Response.json({
            items: [
              series,
              instance(3, { summary: 'Moved' }),
              instance(5, { status: 'cancelled' }),
            ],
          }),
      },
    ]);
    const { events } = await calendar.doListEvents({
      calendarId: 'primary',
      timeMin: '2026-11-01T00:00:00Z',
      timeMax: '2026-11-08T00:00:00Z',
      expandRecurring: false,
    });
    expect(events.map((event) => [event.id, event.kind])).toEqual([['series1', 'series']]);
  });

  it('splits a series for thisAndFollowing and keeps its meeting', async () => {
    const { calendar, requests } = fakeGoogle([
      {
        method: 'GET',
        path: /\/events\/series1_20261104T150000Z$/,
        respond: () => Response.json(instance(4)),
      },
      { method: 'GET', path: /\/events\/series1$/, respond: () => Response.json(series) },
      {
        method: 'GET',
        path: /\/events\/series1\/instances$/,
        // Two instances before the cut: the 2nd and the 3rd.
        respond: () => Response.json({ items: [instance(2), instance(3)] }),
      },
      {
        method: 'POST',
        path: /\/calendars\/primary\/events$/,
        respond: async (request) => Response.json({ ...(await request.json()), id: 'series2' }),
      },
      { method: 'PATCH', path: /\/events\/series1$/, respond: () => Response.json(series) },
    ]);

    const { event } = await calendar.doUpdateEvent({
      calendarId: 'primary',
      eventId: 'series1_20261104T150000Z',
      patch: { title: 'Standup v2' },
      scope: 'thisAndFollowing',
    });
    expect(event).toMatchObject({ id: 'series2', kind: 'series', title: 'Standup v2' });

    const created = requests.find((request) => request.method === 'POST');
    expect(created?.body).toMatchObject({
      summary: 'Standup v2',
      start: { dateTime: '2026-11-04T10:00:00-05:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-04T10:15:00-05:00', timeZone: 'America/New_York' },
      recurrence: ['RRULE:FREQ=DAILY;COUNT=3', 'EXDATE;TZID=America/New_York:20261105T100000'],
      conferenceData: series.conferenceData,
      attendees: series.attendees,
    });
    expect(created?.url.searchParams.get('conferenceDataVersion')).toBe('1');

    const trimmed = requests.find((request) => request.method === 'PATCH');
    expect(trimmed?.body).toEqual({ recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261104T145959Z'] });
    expect(trimmed?.headers.get('if-match')).toBe('"m1"');
  });

  it('counts COUNT positions, not listed instances, when splitting', async () => {
    let recurrence = ['RRULE:FREQ=DAILY;COUNT=5'];
    const { calendar, requests } = fakeGoogle([
      {
        method: 'GET',
        path: /\/events\/series1_20261104T150000Z$/,
        respond: () => Response.json(instance(4)),
      },
      {
        method: 'GET',
        path: /\/events\/series1$/,
        respond: () => Response.json({ ...series, recurrence }),
      },
      {
        method: 'GET',
        path: /\/events\/series1\/instances$/,
        // November 2 was moved past the cut, and November 3 was deleted.
        respond: () =>
          Response.json({
            items: [
              instance(2, { start: instance(10).start, end: instance(10).end }),
              instance(3, { status: 'cancelled' }),
              instance(4),
              instance(5),
              instance(6),
            ],
          }),
      },
      {
        method: 'POST',
        path: /\/events$/,
        respond: async (request) => Response.json({ ...(await request.json()), id: 'series2' }),
      },
      { method: 'PATCH', path: /\/events\/series1$/, respond: () => Response.json(series) },
    ]);
    await calendar.doUpdateEvent({
      calendarId: 'primary',
      eventId: 'series1_20261104T150000Z',
      patch: { title: 'x' },
      scope: 'thisAndFollowing',
    });
    // November 2 and the deleted November 3 used two of the five positions.
    const created = requests.find((request) => request.method === 'POST');
    expect(created?.body).toMatchObject({ recurrence: ['RRULE:FREQ=DAILY;COUNT=3'] });

    // An EXDATE may or may not be one of the rule's positions, so it is not guessed.
    recurrence = ['RRULE:FREQ=DAILY;COUNT=5', 'EXDATE;TZID=America/New_York:20261103T100000'];
    requests.length = 0;
    await expect(
      calendar.doUpdateEvent({
        calendarId: 'primary',
        eventId: 'series1_20261104T150000Z',
        patch: { title: 'x' },
        scope: 'thisAndFollowing',
      }),
    ).rejects.toSatisfy(UnsupportedFunctionalityError.isInstance);
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('moves rule dates with a new start, and splits RDATEs between the halves', async () => {
    const { calendar, requests } = fakeGoogle([
      {
        method: 'GET',
        path: /\/events\/series1_20261104T150000Z$/,
        respond: () => Response.json(instance(4)),
      },
      {
        method: 'GET',
        path: /\/events\/series1$/,
        respond: () =>
          Response.json({
            ...series,
            recurrence: [
              'RRULE:FREQ=DAILY',
              'EXDATE;TZID=America/New_York:20261105T100000',
              'RDATE;TZID=America/New_York:20261101T150000,20261109T150000',
            ],
          }),
      },
      {
        method: 'POST',
        path: /\/events$/,
        respond: () => Response.json({ ...series, id: 'series2' }),
      },
      { method: 'PATCH', path: /\/events\/series1$/, respond: () => Response.json(series) },
    ]);
    const zone = 'America/New_York';
    await calendar.doUpdateEvent({
      calendarId: 'primary',
      eventId: 'series1_20261104T150000Z',
      patch: {
        start: { dateTime: '2026-11-04T12:00:00-05:00', timeZone: zone },
        end: { dateTime: '2026-11-04T12:15:00-05:00', timeZone: zone },
      },
      scope: 'thisAndFollowing',
    });
    const created = requests.find((request) => request.method === 'POST');
    expect(created?.body).toMatchObject({
      recurrence: [
        'RRULE:FREQ=DAILY',
        'EXDATE;TZID=America/New_York:20261105T120000',
        'RDATE;TZID=America/New_York:20261109T170000',
      ],
    });
    const trimmed = requests.find((request) => request.method === 'PATCH');
    expect(trimmed?.body).toEqual({
      recurrence: [
        'RRULE:FREQ=DAILY;UNTIL=20261104T145959Z',
        'RDATE;TZID=America/New_York:20261101T150000',
      ],
    });
  });

  it('moves a whole series on its wall clock, with its weekdays and exclusions', async () => {
    // Weekly on Mondays at 10:00 in New York from February 23. The March 2 occurrence moves
    // to Tuesday March 10 at 10:00, after summer time starts on March 8.
    const zone = 'America/New_York';
    const at = (dateTime: string) => ({ dateTime, timeZone: zone });
    const { calendar, requests } = fakeGoogle([
      {
        method: 'GET',
        path: /\/events\/series1_20260302T150000Z$/,
        respond: () =>
          Response.json({
            ...instance(2),
            id: 'series1_20260302T150000Z',
            originalStartTime: at('2026-03-02T10:00:00-05:00'),
            start: at('2026-03-02T10:00:00-05:00'),
            end: at('2026-03-02T10:15:00-05:00'),
          }),
      },
      {
        method: 'GET',
        path: /\/events\/series1$/,
        respond: () =>
          Response.json({
            ...series,
            iCalUID: 'series1@google.com',
            start: at('2026-02-23T10:00:00-05:00'),
            end: at('2026-02-23T10:15:00-05:00'),
            recurrence: [
              'RRULE:FREQ=WEEKLY;BYDAY=MO',
              'EXDATE;TZID=America/New_York:20260316T100000',
            ],
          }),
      },
      {
        method: 'GET',
        path: /\/calendars\/primary\/events$/,
        // Google drops these when the start moves: one deleted occurrence, one edited.
        respond: () =>
          Response.json({
            items: [
              { id: 'series1', iCalUID: 'series1@google.com' },
              {
                id: 'series1_20260309T140000Z',
                recurringEventId: 'series1',
                status: 'cancelled',
                originalStartTime: at('2026-03-09T10:00:00-04:00'),
              },
              {
                id: 'series1_20260323T140000Z',
                recurringEventId: 'series1',
                summary: 'Edited',
                originalStartTime: at('2026-03-23T10:00:00-04:00'),
              },
            ],
          }),
      },
      { method: 'PATCH', path: /\/events\/series1$/, respond: () => Response.json(series) },
    ]);
    const { warnings } = await calendar.doUpdateEvent({
      calendarId: 'primary',
      eventId: 'series1_20260302T150000Z',
      patch: { start: at('2026-03-10T10:00:00-04:00'), end: at('2026-03-10T10:15:00-04:00') },
      scope: 'all',
    });
    const patch = requests.find((request) => request.method === 'PATCH');
    expect(patch?.body).toMatchObject({
      start: at('2026-03-03T10:00:00-05:00'),
      end: at('2026-03-03T10:15:00-05:00'),
      recurrence: [
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'EXDATE;TZID=America/New_York:20260324T100000',
        // The deleted March 9 occurrence, moved to March 17.
        'EXDATE:20260317T140000Z',
      ],
    });
    expect(warnings).toMatchObject([{ type: 'compatibility', feature: 'scope' }]);
  });

  it('keeps a series two hours long across DST, and keeps its time zone', async () => {
    // Daily at 01:30-03:30 in New York from March 6. Summer time starts on March 8 at 02:00.
    const zone = 'America/New_York';
    const at = (dateTime: string, timeZone = zone) => ({ dateTime, timeZone });
    const { calendar, requests } = fakeGoogle([
      {
        method: 'GET',
        path: /\/events\/series1_20260308T063000Z$/,
        respond: () =>
          Response.json({
            ...instance(8),
            id: 'series1_20260308T063000Z',
            originalStartTime: at('2026-03-08T01:30:00-05:00'),
            start: at('2026-03-08T01:30:00-05:00'),
            end: at('2026-03-08T04:30:00-04:00'),
          }),
      },
      {
        method: 'GET',
        path: /\/events\/series1$/,
        respond: () =>
          Response.json({
            ...series,
            start: at('2026-03-06T01:30:00-05:00'),
            end: at('2026-03-06T03:30:00-05:00'),
            recurrence: ['RRULE:FREQ=DAILY'],
          }),
      },
      {
        method: 'POST',
        path: /\/events$/,
        respond: async (request) => Response.json({ ...(await request.json()), id: 'series2' }),
      },
      { method: 'PATCH', path: /\/events\/series1$/, respond: () => Response.json(series) },
    ]);
    const update = (
      patch: Parameters<typeof calendar.doUpdateEvent>[0]['patch'],
      scope: 'all' | 'thisAndFollowing',
    ) =>
      calendar.doUpdateEvent({
        calendarId: 'primary',
        eventId: 'series1_20260308T063000Z',
        patch,
        scope,
      });

    await update({ title: 'x' }, 'thisAndFollowing');
    expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
      start: at('2026-03-08T01:30:00-05:00'),
      end: at('2026-03-08T04:30:00-04:00'),
    });

    requests.length = 0;
    await update(
      { start: at('2026-03-09T01:30:00-04:00'), end: at('2026-03-09T03:30:00-04:00') },
      'all',
    );
    expect(requests.find((request) => request.method === 'PATCH')?.body).toMatchObject({
      start: at('2026-03-07T01:30:00-05:00'),
      end: at('2026-03-07T03:30:00-05:00'),
    });

    // The rule's dates are in New York time, so the series cannot switch zones here.
    await expect(update({ start: at('2026-03-08T06:30:00Z', 'UTC') }, 'all')).rejects.toSatisfy(
      InvalidArgumentError.isInstance,
    );
  });

  it('removes the new series when trimming the old one fails, even after cancellation', async () => {
    let controller = new AbortController();
    let deleteResponse = 204;
    const { calendar, requests } = fakeGoogle([
      {
        method: 'GET',
        path: /\/events\/series1_20261104T150000Z$/,
        respond: () => Response.json(instance(4)),
      },
      {
        method: 'GET',
        path: /\/events\/series1$/,
        respond: () => Response.json({ ...series, recurrence: ['RRULE:FREQ=DAILY'] }),
      },
      {
        method: 'POST',
        path: /\/events$/,
        respond: () => {
          // The caller gives up after the new series exists.
          controller.abort(new Error('cancelled'));
          return Response.json({ ...series, id: 'series2' });
        },
      },
      {
        method: 'DELETE',
        path: /\/events\/series2$/,
        respond: () =>
          deleteResponse === 204 ? new Response(null, { status: 204 }) : googleError(500),
      },
    ]);
    const split = () =>
      calendar.doUpdateEvent({
        calendarId: 'primary',
        eventId: 'series1_20261104T150000Z',
        patch: { title: 'x' },
        scope: 'thisAndFollowing',
        abortSignal: controller.signal,
      });
    await expect(split()).rejects.toThrow('cancelled');
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE' });

    controller = new AbortController();
    deleteResponse = 500;
    await expect(split()).rejects.toThrow(/"series2" it created could not be removed/);
  });

  it('treats deleted events as not found', async () => {
    const { calendar } = fakeGoogle([
      {
        method: 'GET',
        path: /\/events\/e1$/,
        respond: () => Response.json({ id: 'e1', status: 'cancelled' }),
      },
    ]);
    await expect(calendar.doGetEvent({ calendarId: 'primary', eventId: 'e1' })).rejects.toSatisfy(
      NotFoundError.isInstance,
    );
    await expect(
      calendar.doUpdateEvent({ calendarId: 'primary', eventId: 'e1', patch: { title: 'x' } }),
    ).rejects.toSatisfy(NotFoundError.isInstance);
  });

  it('maps Google rate limits, permissions and expired sync tokens', async () => {
    const respondWith = (response: () => Response) =>
      fakeGoogle([{ method: 'GET', path: /./, respond: response }]).calendar;

    await expect(
      respondWith(() => googleError(403, 'rateLimitExceeded')).doGetEvent({
        calendarId: 'primary',
        eventId: 'e',
      }),
    ).rejects.toSatisfy(RateLimitError.isInstance);
    await expect(
      respondWith(() => googleError(403, 'forbidden')).doGetEvent({
        calendarId: 'primary',
        eventId: 'e',
      }),
    ).rejects.toSatisfy(PermissionDeniedError.isInstance);
    await expect(
      respondWith(() => googleError(410, 'fullSyncRequired')).doSyncEvents({
        calendarId: 'primary',
        cursor: 'old',
      }),
    ).rejects.toSatisfy(SyncCursorExpiredError.isInstance);
  });

  it('reports sync deletes and returns the cursor on the last page', async () => {
    const { calendar, requests } = fakeGoogle([
      {
        method: 'GET',
        path: /\/events$/,
        respond: () =>
          Response.json({
            timeZone: 'UTC',
            nextSyncToken: 'next',
            items: [{ id: 'gone', status: 'cancelled' }, instance(3, { summary: 'Moved' })],
          }),
      },
    ]);
    const result = await calendar.doSyncEvents({ calendarId: 'primary', cursor: 'prev' });
    expect(result.changes).toEqual([
      { type: 'delete', eventId: 'gone' },
      { type: 'upsert', event: expect.objectContaining({ kind: 'exception', title: 'Moved' }) },
    ]);
    expect(result.nextCursor).toBe('next');
    expect(requests[0]?.url.searchParams.get('syncToken')).toBe('prev');
  });

  it('saves colors outside the palette as the nearest one, with a warning', async () => {
    const { calendar, requests } = fakeGoogle([
      {
        method: 'POST',
        path: /\/events$/,
        respond: async (request) => Response.json({ ...(await request.json()), id: 'e1' }),
      },
    ]);
    const { event, warnings } = await calendar.doCreateEvent({
      calendarId: 'primary',
      event: { start: { date: '2026-11-03' }, end: { date: '2026-11-04' }, color: '#d00000' },
    });
    expect(requests[0]?.body).toMatchObject({ colorId: '11' });
    expect(event.color).toBe('#d50000');
    expect(warnings).toEqual([
      expect.objectContaining({ type: 'compatibility', feature: 'color' }),
    ]);
  });
});
