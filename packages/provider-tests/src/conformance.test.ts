import { mockCalendar } from '@calsdk/mock';
import {
  type CalendarProviderV1,
  ConflictError,
  type EventPatchV1,
  type EventV1,
  type FreeBusyResultV1,
  NotFoundError,
  type UpdateScopeV1,
} from '@calsdk/provider';
import {
  createJsonFetcher,
  type FetchFunction,
  isAllDay,
  mapAPICallError,
  urlPath,
} from '@calsdk/provider-utils';
import { describeProviderConformance } from './conformance';

// A provider that reads and updates events over HTTP, backed by an in-process server
// around the mock. It runs the suite's HTTP tests the way a real provider would.
const backend = mockCalendar({ calendars: [{ id: 'primary' }] });

const server: FetchFunction = async (input, init) => {
  const request = new Request(input, init);
  const [, calendarId = '', eventId = ''] =
    /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(new URL(request.url).pathname) ?? [];
  const ids = { calendarId: decodeURIComponent(calendarId), eventId: decodeURIComponent(eventId) };
  try {
    const { event } =
      request.method === 'PATCH'
        ? await backend.doUpdateEvent({
            ...ids,
            patch: (await request.json()) as EventPatchV1,
            ifMatch: request.headers.get('if-match') ?? undefined,
            scope: (new URL(request.url).searchParams.get('scope') ?? undefined) as UpdateScopeV1,
          })
        : await backend.doGetEvent(ids);
    return Response.json(event);
  } catch (error) {
    if (NotFoundError.isInstance(error)) return Response.json({}, { status: 404 });
    if (ConflictError.isInstance(error)) return Response.json({}, { status: 412 });
    throw error;
  }
};

function httpCalendar(fetch: FetchFunction): CalendarProviderV1 {
  const api = createJsonFetcher({ baseURL: 'https://calendar.test', accessToken: 'token', fetch });
  const provider = 'http-test';
  return {
    ...backend,
    provider,
    capabilities: { ...backend.capabilities, freeBusy: true },
    async doFreeBusy({ calendarIds, timeMin, timeMax }) {
      const calendars: FreeBusyResultV1['calendars'] = {};
      for (const calendarId of calendarIds) {
        const { events } = await backend.doListEvents({
          calendarId,
          timeMin,
          timeMax,
          expandRecurring: true,
        });
        calendars[calendarId] = {
          busy: events.flatMap(({ start, end, showAs }) =>
            showAs === 'busy' && !isAllDay(start) && !isAllDay(end)
              ? [{ start: start.dateTime, end: end.dateTime }]
              : [],
          ),
        };
      }
      return { calendars, warnings: [] };
    },
    async doGetEvent({ calendarId, eventId, headers, abortSignal }) {
      const resource = { type: 'event', id: eventId } as const;
      try {
        const { rawValue } = await api({
          method: 'GET',
          path: urlPath`/calendars/${calendarId}/events/${eventId}`,
          headers,
          abortSignal,
        });
        return { event: rawValue as EventV1, warnings: [] };
      } catch (error) {
        throw mapAPICallError(error, { provider, resource });
      }
    },
    async doUpdateEvent({ calendarId, eventId, patch, scope, ifMatch, headers, abortSignal }) {
      try {
        const { rawValue } = await api({
          method: 'PATCH',
          path: urlPath`/calendars/${calendarId}/events/${eventId}`,
          query: { scope },
          body: patch,
          headers: { ...headers, 'if-match': ifMatch },
          abortSignal,
        });
        return { event: rawValue as EventV1, warnings: [] };
      } catch (error) {
        throw mapAPICallError(error, {
          provider,
          resource: { type: 'event', id: eventId },
          eventId,
        });
      }
    },
  };
}

describeProviderConformance({
  name: 'http-test',
  // Without a recording the suite passes the global fetch: route it to the local server.
  createProvider: ({ fetch }) => httpCalendar(fetch === globalThis.fetch ? server : fetch),
});

// A provider that keeps titles but replaces an event on every update, which the contract
// allows. Recurrence and etags are off: a replaced instance or etag has nothing to match.
const replacing = mockCalendar({ calendars: [{ id: 'primary' }] });

describeProviderConformance({
  name: 'replacing',
  http: false,
  createProvider: () => ({
    ...replacing,
    provider: 'replacing',
    capabilities: {
      ...replacing.capabilities,
      events: { ...replacing.capabilities.events, recurrence: false, etag: false },
    },
    async doUpdateEvent(options) {
      const { event } = await replacing.doUpdateEvent(options);
      const { id, calendarId, kind, status, etag, createdAt, updatedAt, ...input } = event;
      const copy = await replacing.doCreateEvent({ calendarId: options.calendarId, event: input });
      await replacing.doDeleteEvent({ calendarId: options.calendarId, eventId: id });
      return copy;
    },
  }),
});
