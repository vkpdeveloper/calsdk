import {
  ConflictError,
  NotFoundError,
  SyncCursorExpiredError,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { microsoft } from './microsoft-provider';

type Route = {
  method: string;
  path: RegExp;
  respond: (request: Request) => Response | Promise<Response>;
};

/** A fake Microsoft Graph: each request goes to the first matching route. */
function fakeGraph(routes: Route[]) {
  const requests: { method: string; url: URL; body: unknown; headers: Headers }[] = [];
  const calendar = microsoft({
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
          candidate.path.test(url.pathname.replace('/v1.0', '')),
      );
      if (!route) throw new Error(`Unexpected ${request.method} ${url.pathname}`);
      return route.respond(request);
    },
  });
  return { calendar, requests };
}

const graphError = (status: number, code: string, message = 'stubbed') =>
  Response.json({ error: { code, message } }, { status });

const event = (extra: Record<string, unknown> = {}) => ({
  id: 'e1',
  '@odata.etag': 'W/"v2"',
  type: 'singleInstance',
  subject: 'Planning',
  start: { dateTime: '2030-01-07T14:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2030-01-07T15:00:00.0000000', timeZone: 'UTC' },
  originalStartTimeZone: 'Eastern Standard Time',
  originalEndTimeZone: 'Eastern Standard Time',
  isAllDay: false,
  showAs: 'busy',
  ...extra,
});

describe('microsoft', () => {
  it('lists calendars across pages and finds the primary one', async () => {
    const { calendar, requests } = fakeGraph([
      {
        method: 'GET',
        path: /^\/me\/calendars$/,
        respond: (request) =>
          new URL(request.url).searchParams.has('$skip')
            ? Response.json({ value: [{ id: 'c2', name: 'Team', canEdit: false }] })
            : Response.json({
                value: [
                  {
                    id: 'c1',
                    name: 'Calendar',
                    hexColor: '#3A87AD',
                    isDefaultCalendar: true,
                    canEdit: true,
                    canShare: true,
                  },
                ],
                '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$skip=1',
              }),
      },
    ]);
    const { calendars } = await calendar.doListCalendars({});
    expect(calendars).toEqual([
      { id: 'c1', name: 'Calendar', color: '#3a87ad', isPrimary: true, accessRole: 'owner' },
      { id: 'c2', name: 'Team', color: undefined, isPrimary: false, accessRole: 'reader' },
    ]);
    expect(requests[0]?.headers.get('prefer')).toContain('outlook.timezone="UTC"');
  });

  it('reads UTC times in the zone the event was scheduled in', async () => {
    const { calendar } = fakeGraph([
      {
        method: 'GET',
        path: /^\/me\/calendar\/events\/e1$/,
        respond: () => Response.json(event()),
      },
      {
        method: 'GET',
        path: /^\/me\/calendar\/events\/e2$/,
        // An all-day event Outlook stored in New York time: midnight there is 05:00 UTC.
        respond: () =>
          Response.json(
            event({
              id: 'e2',
              isAllDay: true,
              start: { dateTime: '2030-01-08T05:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2030-01-09T05:00:00.0000000', timeZone: 'UTC' },
            }),
          ),
      },
    ]);
    const timed = await calendar.doGetEvent({ calendarId: 'primary', eventId: 'e1' });
    expect(timed.event).toMatchObject({
      kind: 'single',
      start: { dateTime: '2030-01-07T09:00:00-05:00', timeZone: 'America/New_York' },
      etag: 'W/"v2"',
    });
    const allDay = await calendar.doGetEvent({ calendarId: 'primary', eventId: 'e2' });
    expect(allDay.event).toMatchObject({
      start: { date: '2030-01-08' },
      end: { date: '2030-01-09' },
    });
  });

  it('checks the etag before deleting, since Outlook ignores If-Match on DELETE', async () => {
    const { calendar, requests } = fakeGraph([
      { method: 'GET', path: /\/events\/e1$/, respond: () => Response.json(event()) },
      {
        method: 'DELETE',
        path: /\/events\/e1$/,
        respond: () => new Response(null, { status: 204 }),
      },
    ]);
    await expect(
      calendar.doDeleteEvent({ calendarId: 'primary', eventId: 'e1', ifMatch: 'W/"v1"' }),
    ).rejects.toSatisfy(ConflictError.isInstance);
    expect(requests.map((request) => request.method)).toEqual(['GET']);

    await calendar.doDeleteEvent({ calendarId: 'primary', eventId: 'e1', ifMatch: 'W/"v2"' });
    expect(requests.map((request) => request.method)).toEqual(['GET', 'GET', 'DELETE']);
  });

  it('reports writes to deleted events and malformed ids as not found', async () => {
    const { calendar } = fakeGraph([
      {
        method: 'PATCH',
        path: /\/events\/deleted$/,
        respond: () =>
          graphError(
            400,
            'ErrorInvalidRequest',
            "Your request can't be completed. This operation does not support binding to a non-calendar folder.",
          ),
      },
      {
        method: 'GET',
        path: /\/events\/bad$/,
        respond: () => graphError(400, 'ErrorInvalidIdMalformed'),
      },
    ]);
    await expect(
      calendar.doUpdateEvent({ calendarId: 'primary', eventId: 'deleted', patch: { title: 'x' } }),
    ).rejects.toSatisfy(NotFoundError.isInstance);
    await expect(calendar.doGetEvent({ calendarId: 'primary', eventId: 'bad' })).rejects.toSatisfy(
      NotFoundError.isInstance,
    );
  });

  it('syncs a fixed window and skips unmodified occurrences', async () => {
    const deltaLink =
      'https://graph.microsoft.com/v1.0/me/calendar/calendarView/delta?$deltatoken=t1';
    const { calendar, requests } = fakeGraph([
      {
        method: 'GET',
        path: /\/calendarView\/delta$/,
        respond: (request) => {
          const token = new URL(request.url).searchParams.get('$deltatoken');
          if (token === 'expired') return graphError(410, 'SyncStateNotFound');
          return Response.json({
            value: [
              event({ id: 's1', type: 'seriesMaster' }),
              { id: 's1-occ', type: 'occurrence', seriesMasterId: 's1', start: event().start },
              { id: 'gone', '@removed': { reason: 'deleted' } },
            ],
            '@odata.deltaLink': deltaLink,
          });
        },
      },
    ]);
    const page = await calendar.doSyncEvents({
      calendarId: 'primary',
      providerOptions: {
        microsoft: { timeMin: '2030-01-01T00:00:00Z', timeMax: '2031-01-01T00:00:00Z' },
      },
    });
    expect(requests[0]?.url.searchParams.get('startDateTime')).toBe('2030-01-01T00:00:00Z');
    expect(requests[0]?.url.searchParams.get('endDateTime')).toBe('2031-01-01T00:00:00Z');
    expect(page.changes).toEqual([
      { type: 'upsert', event: expect.objectContaining({ id: 's1', kind: 'series' }) },
      { type: 'delete', eventId: 'gone' },
    ]);
    expect(page.nextCursor).toBe(deltaLink);

    await calendar.doSyncEvents({ calendarId: 'primary', cursor: deltaLink });
    expect(requests[1]?.url.href).toBe(deltaLink);
    await expect(
      calendar.doSyncEvents({ calendarId: 'primary', cursor: deltaLink.replace('t1', 'expired') }),
    ).rejects.toSatisfy(SyncCursorExpiredError.isInstance);
  });

  it('only lists series masters that can occur in the window', async () => {
    const master = (id: string, start: string, range: Record<string, unknown>) =>
      event({
        id,
        type: 'seriesMaster',
        start: { dateTime: start, timeZone: 'UTC' },
        end: { dateTime: start.replace('T14', 'T15'), timeZone: 'UTC' },
        recurrence: {
          pattern: { type: 'daily', interval: 1 },
          range: { startDate: start.slice(0, 10), recurrenceTimeZone: 'UTC', ...range },
        },
      });
    const { calendar, requests } = fakeGraph([
      {
        method: 'GET',
        path: /\/events$/,
        respond: () =>
          Response.json({
            value: [
              master('ended', '2029-01-01T14:00:00', { type: 'endDate', endDate: '2029-02-01' }),
              master('ongoing', '2029-01-01T14:00:00', { type: 'noEnd' }),
              master('later', '2031-01-01T14:00:00', { type: 'noEnd' }),
            ],
          }),
      },
    ]);
    const { events } = await calendar.doListEvents({
      calendarId: 'primary',
      timeMin: '2030-01-01T00:00:00Z',
      timeMax: '2030-02-01T00:00:00Z',
      expandRecurring: false,
    });
    expect(events.map((item) => item.id)).toEqual(['ongoing']);
    expect(requests[0]?.url.searchParams.get('$filter')).toBe(
      "type eq 'seriesMaster' or (start/dateTime lt '2030-02-01T00:00:00.000Z' and end/dateTime gt '2030-01-01T00:00:00.000Z')",
    );
  });

  it('refuses thisAndFollowing on an occurrence instead of changing more or less', async () => {
    const occurrence = event({ id: 'o2', type: 'occurrence', seriesMasterId: 's1' });
    const { calendar, requests } = fakeGraph([
      { method: 'GET', path: /\/events\/o2$/, respond: () => Response.json(occurrence) },
      {
        method: 'GET',
        path: /\/events\/s1$/,
        respond: () => Response.json(event({ id: 's1', type: 'seriesMaster' })),
      },
    ]);
    for (const write of [
      () =>
        calendar.doUpdateEvent({
          calendarId: 'primary',
          eventId: 'o2',
          patch: { title: 'x' },
          scope: 'thisAndFollowing',
        }),
      () =>
        calendar.doDeleteEvent({ calendarId: 'primary', eventId: 'o2', scope: 'thisAndFollowing' }),
    ]) {
      await expect(write()).rejects.toSatisfy(UnsupportedFunctionalityError.isInstance);
    }
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('warns about what Outlook cannot do on create', async () => {
    const { calendar, requests } = fakeGraph([
      {
        method: 'POST',
        path: /^\/me\/calendar\/events$/,
        // Personal accounts accept the request but create no Teams meeting.
        respond: () => Response.json(event({ isOnlineMeeting: false }), { status: 201 }),
      },
    ]);
    const { warnings } = await calendar.doCreateEvent({
      calendarId: 'primary',
      event: {
        title: 'Planning',
        start: { dateTime: '2030-01-07T09:00:00-05:00', timeZone: 'America/New_York' },
        end: { dateTime: '2030-01-07T10:00:00-05:00', timeZone: 'America/New_York' },
        createConference: true,
        color: '#ff0000',
      },
      sendUpdates: 'none',
    });
    expect(requests[0]?.body).toMatchObject({
      start: { dateTime: '2030-01-07T09:00:00', timeZone: 'America/New_York' },
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    });
    expect(warnings.map((warning) => 'feature' in warning && warning.feature)).toEqual([
      'sendUpdates',
      'color',
      'createConference',
    ]);
  });
});
