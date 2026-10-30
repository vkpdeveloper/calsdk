import {
  APICallError,
  type CalendarProviderV1,
  type CalendarV1,
  type CallOptionsV1,
  ConflictError,
  type EventTimeV1,
  InvalidArgumentError,
  NotFoundError,
  type SendUpdatesV1,
  type SyncChangeV1,
  SyncCursorExpiredError,
  UnsupportedFunctionalityError,
  type WarningV1,
} from '@calsdk/provider';
import {
  type AccessToken,
  addDaysToDate,
  createJsonFetcher,
  type FetchFunction,
  formatZonedDateTime,
  isAllDay,
  mapAPICallError,
  parseProviderOptions,
  type QueryValue,
  urlPath,
} from '@calsdk/provider-utils';
import type { z } from 'zod';
import { eventTimes, fromGraphEvent, type GraphEventWrite, toGraphWrite } from './convert-event';
import { graphTimeToInstant, toGraphTime } from './graph-time';
import {
  type GraphEvent,
  graphCalendarListSchema,
  graphErrorSchema,
  graphEventListSchema,
  graphEventSchema,
} from './microsoft-api';
import { microsoftEventOptionsSchema, microsoftSyncOptionsSchema } from './microsoft-options';

export type MicrosoftCalendarSettings = {
  /**
   * A Microsoft Graph access token with `Calendars.ReadWrite` (or `Calendars.Read`), or a
   * function returning a fresh one per request.
   */
  accessToken: AccessToken;
  /** Defaults to `https://graph.microsoft.com/v1.0`. */
  baseURL?: string;
  /** Headers sent with every request. */
  headers?: Record<string, string | undefined>;
  /** Custom fetch, for example to add logging or to record requests in tests. */
  fetch?: FetchFunction;
};

export type MicrosoftCalendarProvider = CalendarProviderV1 &
  Required<Pick<CalendarProviderV1, 'doSyncEvents'>>;

const PROVIDER = 'microsoft';
const MAX_PAGE_SIZE = 1000;
// Graph pages hold 10 events unless asked for more.
const DEFAULT_PAGE_SIZE = 250;
const SYNC_PAGE_SIZE = 200;
const DAY_MS = 86_400_000;
// UTC times and text bodies keep conversion simple. Immutable ids survive moving an
// event between calendars, so stored ids stay valid.
const PREFER = 'outlook.timezone="UTC", outlook.body-content-type="text", IdType="ImmutableId"';
const EXPIRED_SYNC_CODES = new Set(['SyncStateNotFound', 'SyncStateInvalid', 'resyncRequired']);

/**
 * Creates a Microsoft Outlook calendar provider backed by Microsoft Graph. Works with work,
 * school and personal Microsoft accounts.
 *
 * @example
 * import { microsoft } from '@calsdk/microsoft';
 * const calendar = microsoft({ accessToken: () => getFreshToken() });
 */
export function microsoft(settings: MicrosoftCalendarSettings): MicrosoftCalendarProvider {
  const api = createJsonFetcher({
    baseURL: settings.baseURL ?? 'https://graph.microsoft.com/v1.0',
    accessToken: settings.accessToken,
    headers: settings.headers,
    fetch: settings.fetch,
  });

  type Call = Pick<CallOptionsV1, 'headers' | 'abortSignal'>;
  type ErrorContext = {
    resource?: { type: 'calendar' | 'event'; id: string };
    eventId?: string;
    syncCalendarId?: string;
  };

  async function request<Output>(
    call: Call,
    context: ErrorContext,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      path: string;
      query?: Record<string, QueryValue | QueryValue[]>;
      body?: unknown;
      headers?: Record<string, string | undefined>;
      schema?: z.ZodType<Output>;
    },
  ): Promise<Output> {
    try {
      const { value } = await api({
        ...options,
        headers: { prefer: PREFER, ...call.headers, ...options.headers },
        abortSignal: call.abortSignal,
      });
      return value;
    } catch (error) {
      throw mapMicrosoftError(error, context);
    }
  }

  const calendarPath = (calendarId: string) =>
    calendarId === 'primary' ? '/me/calendar' : urlPath`/me/calendars/${calendarId}`;
  const eventPath = (calendarId: string, eventId: string) =>
    calendarPath(calendarId) + urlPath`/events/${eventId}`;

  async function getRaw(call: Call, calendarId: string, eventId: string): Promise<GraphEvent> {
    return request(
      call,
      // Reads precede conditional writes, so a 412 here is a conflict too.
      { resource: { type: 'event', id: eventId }, eventId },
      { method: 'GET', path: eventPath(calendarId, eventId), schema: graphEventSchema },
    );
  }

  async function patchRaw(
    call: Call,
    calendarId: string,
    eventId: string,
    body: GraphEventWrite & Record<string, unknown>,
    ifMatch: string | undefined,
  ) {
    return request(
      call,
      { resource: { type: 'event', id: eventId }, eventId },
      {
        method: 'PATCH',
        path: eventPath(calendarId, eventId),
        body,
        headers: { 'if-match': ifMatch },
        schema: graphEventSchema,
      },
    );
  }

  // Outlook ignores If-Match on DELETE, so conditional deletes compare the etag first.
  async function deleteRaw(call: Call, calendarId: string, eventId: string) {
    await request(
      call,
      { resource: { type: 'event', id: eventId } },
      { method: 'DELETE', path: eventPath(calendarId, eventId) },
    );
  }

  function assertEtag(raw: GraphEvent, ifMatch: string | undefined) {
    if (ifMatch !== undefined && raw['@odata.etag'] !== ifMatch) {
      throw new ConflictError({ provider: PROVIDER, eventId: raw.id });
    }
  }

  /** The series an instance belongs to, or `undefined` for singles and series masters. */
  async function seriesOf(call: Call, calendarId: string, raw: GraphEvent) {
    if (raw.type !== 'occurrence' && raw.type !== 'exception') return undefined;
    if (!raw.seriesMasterId) return undefined;
    return getRaw(call, calendarId, raw.seriesMasterId);
  }

  function thisAndFollowingUnsupported() {
    return new UnsupportedFunctionalityError({
      provider: PROVIDER,
      functionality: 'scope "thisAndFollowing"',
      message:
        'Microsoft Outlook has no way to change this and following occurrences. Use scope "this" or "all", or end the series and create a new one.',
    });
  }

  async function eventOptions(providerOptions: CallOptionsV1['providerOptions']) {
    return parseProviderOptions({
      provider: PROVIDER,
      providerOptions,
      schema: microsoftEventOptionsSchema,
    });
  }

  return {
    specificationVersion: 'v1',
    provider: PROVIDER,
    capabilities: {
      events: {
        recurrence: true,
        recurrenceScopeThisAndFollowing: false,
        serverSideExpansion: true,
        attendees: true,
        conference: { condition: 'Teams meetings need a work or school account.' },
        reminders: { condition: 'One popup reminder per event.' },
        color: false,
        etag: true,
        search: false,
      },
      freeBusy: false,
      sync: true,
      webhooks: false,
    },

    async doListCalendars(call) {
      const calendars: CalendarV1[] = [];
      let next: string | undefined;
      do {
        const page = await request(
          call,
          {},
          {
            method: 'GET',
            path: next ?? '/me/calendars',
            query: next ? undefined : { $top: 100 },
            schema: graphCalendarListSchema,
          },
        );
        for (const item of page.value) {
          calendars.push({
            id: item.id,
            name: item.name ?? item.id,
            color: /^#[0-9a-f]{6}$/i.test(item.hexColor ?? '')
              ? item.hexColor?.toLowerCase()
              : undefined,
            isPrimary: item.isDefaultCalendar === true,
            // Only the owner can share a calendar.
            accessRole: item.canShare ? 'owner' : item.canEdit ? 'writer' : 'reader',
          });
        }
        next = page['@odata.nextLink'];
      } while (next !== undefined);
      return { calendars, warnings: [] };
    },

    async doGetEvent({ calendarId, eventId, ...call }) {
      const raw = await getRaw(call, calendarId, eventId);
      return { event: fromGraphEvent(raw, { calendarId }), warnings: [] };
    },

    async doListEvents({
      calendarId,
      timeMin,
      timeMax,
      expandRecurring,
      query,
      pageSize,
      pageToken,
      ...call
    }) {
      if (query !== undefined) {
        throw new UnsupportedFunctionalityError({
          provider: PROVIDER,
          functionality: 'event search',
          message:
            'Microsoft Graph cannot search calendar views. Filter the listed events instead.',
        });
      }
      const min = new Date(timeMin).toISOString();
      const max = new Date(timeMax).toISOString();
      const top = Math.min(pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const page = await request(
        call,
        { resource: { type: 'calendar', id: calendarId } },
        pageToken !== undefined
          ? { method: 'GET', path: pageToken, schema: graphEventListSchema }
          : expandRecurring
            ? {
                method: 'GET',
                path: `${calendarPath(calendarId)}/calendarView`,
                query: {
                  startDateTime: min,
                  endDateTime: max,
                  $orderby: 'start/dateTime',
                  $top: top,
                },
                schema: graphEventListSchema,
              }
            : {
                method: 'GET',
                path: `${calendarPath(calendarId)}/events`,
                query: {
                  // A series master's own times are its first occurrence, so masters are
                  // fetched by type and narrowed below.
                  $filter: `type eq 'seriesMaster' or (start/dateTime lt '${max}' and end/dateTime gt '${min}')`,
                  $orderby: 'start/dateTime',
                  $top: top,
                },
                schema: graphEventListSchema,
              },
      );
      const events = page.value
        .filter(
          (raw) => expandRecurring || raw.type !== 'seriesMaster' || seriesOverlaps(raw, min, max),
        )
        .map((raw) => fromGraphEvent(raw, { calendarId }));
      return { events, nextPageToken: page['@odata.nextLink'], warnings: [] };
    },

    async doCreateEvent({ calendarId, event, sendUpdates, providerOptions, ...call }) {
      const { options, warnings } = await eventOptions(providerOptions);
      warnSendUpdates(sendUpdates, warnings);
      const body = { ...toGraphWrite(event, { seriesStart: event.start, warnings }), ...options };
      const raw = await request(
        call,
        { resource: { type: 'calendar', id: calendarId } },
        {
          method: 'POST',
          path: `${calendarPath(calendarId)}/events`,
          body,
          schema: graphEventSchema,
        },
      );
      if (event.createConference && !raw.onlineMeeting?.joinUrl) {
        warnings.push({
          type: 'unsupported',
          feature: 'createConference',
          details:
            'Outlook did not create a Teams meeting. Personal Microsoft accounts and some work accounts cannot create Teams meetings through Graph.',
        });
      }
      return { event: fromGraphEvent(raw, { calendarId }), warnings };
    },

    async doUpdateEvent({
      calendarId,
      eventId,
      patch,
      scope = 'this',
      ifMatch,
      sendUpdates,
      providerOptions,
      ...call
    }) {
      const { options, warnings } = await eventOptions(providerOptions);
      warnSendUpdates(sendUpdates, warnings);
      // Recurrence is written relative to the series start, and scopes other than `this`
      // need to know whether the event is an instance.
      const current =
        scope !== 'this' || (patch.recurrence && !patch.start)
          ? await getRaw(call, calendarId, eventId)
          : undefined;
      const series =
        current && scope !== 'this' ? await seriesOf(call, calendarId, current) : undefined;

      if (!current || !series) {
        const seriesStart = patch.start ?? (current && eventTimes(current).start);
        const body = { ...toGraphWrite(patch, { seriesStart, warnings }), ...options };
        const raw = await patchRaw(call, calendarId, eventId, body, ifMatch);
        return { event: fromGraphEvent(raw, { calendarId }), warnings };
      }
      if (scope === 'thisAndFollowing') throw thisAndFollowingUnsupported();
      assertEtag(current, ifMatch);
      if (patch.recurrence !== undefined) {
        throw new InvalidArgumentError({
          argument: 'patch.recurrence',
          message:
            'Recurrence cannot be changed through a single instance. Update the series id instead.',
        });
      }
      // Times move the whole series by the distance this instance moves.
      const instance = eventTimes(current);
      const master = eventTimes(series);
      const shifted = {
        ...patch,
        ...(patch.start && { start: shiftTime(master.start, instance.start, patch.start) }),
        ...(patch.end && { end: shiftTime(master.end, instance.end, patch.end) }),
      };
      const body = {
        ...toGraphWrite(shifted, { seriesStart: shifted.start ?? master.start, warnings }),
        ...options,
      };
      // Outlook ties the pattern's start date to the series start, so moving the series to
      // another day rewrites the pattern from there.
      if (shifted.start && series.recurrence) {
        const startDate = toGraphTime(shifted.start).dateTime.slice(0, 10);
        body.recurrence = {
          ...series.recurrence,
          range: { ...series.recurrence.range, startDate },
        };
      }
      const raw = await patchRaw(call, calendarId, series.id, body, series['@odata.etag']);
      return { event: fromGraphEvent(raw, { calendarId }), warnings };
    },

    async doDeleteEvent({ calendarId, eventId, scope = 'this', ifMatch, sendUpdates, ...call }) {
      const warnings: WarningV1[] = [];
      warnSendUpdates(sendUpdates, warnings);
      // A change between this read and the delete is not detected: Outlook has no
      // conditional delete.
      const current =
        scope !== 'this' || ifMatch !== undefined
          ? await getRaw(call, calendarId, eventId)
          : undefined;
      if (current) assertEtag(current, ifMatch);
      const series =
        current && scope !== 'this' ? await seriesOf(call, calendarId, current) : undefined;
      if (!series) {
        await deleteRaw(call, calendarId, eventId);
        return { warnings };
      }
      if (scope === 'thisAndFollowing') throw thisAndFollowingUnsupported();
      await deleteRaw(call, calendarId, series.id);
      return { warnings };
    },

    async doSyncEvents({ calendarId, cursor, pageToken, providerOptions, ...call }) {
      const { options, warnings } = await parseProviderOptions({
        provider: PROVIDER,
        providerOptions,
        schema: microsoftSyncOptionsSchema,
      });
      const now = Date.now();
      const link = pageToken ?? cursor;
      const page = await request(
        call,
        { resource: { type: 'calendar', id: calendarId }, syncCalendarId: calendarId },
        {
          method: 'GET',
          // Graph links carry the window and the sync state.
          path: link ?? `${calendarPath(calendarId)}/calendarView/delta`,
          query:
            link === undefined
              ? {
                  startDateTime: options?.timeMin ?? new Date(now - 365 * DAY_MS).toISOString(),
                  endDateTime: options?.timeMax ?? new Date(now + 2 * 365 * DAY_MS).toISOString(),
                }
              : undefined,
          headers: { prefer: `${PREFER}, odata.maxpagesize=${SYNC_PAGE_SIZE}` },
          schema: graphEventListSchema,
        },
      );
      // Unmodified occurrences arrive as stubs without details. Like other providers'
      // syncs, changes cover singles, series masters and exceptions only.
      const changes = page.value.flatMap((raw): SyncChangeV1[] =>
        raw['@removed'] !== undefined
          ? [{ type: 'delete', eventId: raw.id }]
          : raw.type === 'occurrence'
            ? []
            : [{ type: 'upsert', event: fromGraphEvent(raw, { calendarId }) }],
      );
      return {
        changes,
        nextPageToken: page['@odata.nextLink'],
        nextCursor: page['@odata.nextLink'] === undefined ? page['@odata.deltaLink'] : undefined,
        warnings,
      };
    },
  };
}

/** Whether a series master's occurrences can fall inside `[min, max)`. */
function seriesOverlaps(master: GraphEvent, min: string, max: string): boolean {
  if (graphTimeToInstant(master.start) >= Date.parse(max)) return false;
  const { type, endDate } = master.recurrence?.range ?? {};
  // The last occurrence is on `endDate` in the series' zone: a day of margin covers any zone.
  return (
    type !== 'endDate' ||
    !endDate ||
    Date.parse(`${endDate}T00:00:00Z`) + 2 * DAY_MS > Date.parse(min)
  );
}

function warnSendUpdates(sendUpdates: SendUpdatesV1 | undefined, warnings: WarningV1[]) {
  if (sendUpdates !== undefined && sendUpdates !== 'all') {
    warnings.push({
      type: 'unsupported',
      feature: 'sendUpdates',
      details: 'Outlook always notifies attendees of changes to meetings they are invited to.',
    });
  }
}

/** Moves `time` by the distance between `from` and `to`. */
function shiftTime(time: EventTimeV1, from: EventTimeV1, to: EventTimeV1): EventTimeV1 {
  if (isAllDay(time) && isAllDay(from) && isAllDay(to)) {
    const days = Math.round((Date.parse(to.date) - Date.parse(from.date)) / DAY_MS);
    return { date: addDaysToDate(time.date, days) };
  }
  if (!isAllDay(time) && !isAllDay(from) && !isAllDay(to)) {
    const instant = Date.parse(time.dateTime) + Date.parse(to.dateTime) - Date.parse(from.dateTime);
    return { dateTime: formatZonedDateTime(instant, to.timeZone), timeZone: to.timeZone };
  }
  throw new InvalidArgumentError({
    argument: 'patch.start',
    message:
      'Switching a whole series between all-day and timed through one instance is not supported. Update the series id instead.',
  });
}

function mapMicrosoftError(
  error: unknown,
  {
    resource,
    eventId,
    syncCalendarId,
  }: {
    resource?: { type: 'calendar' | 'event'; id: string };
    eventId?: string;
    syncCalendarId?: string;
  },
): unknown {
  if (APICallError.isInstance(error)) {
    const { code, message } = graphError(error.responseBody);
    if (
      syncCalendarId !== undefined &&
      (error.statusCode === 410 || EXPIRED_SYNC_CODES.has(code))
    ) {
      return new SyncCursorExpiredError({
        provider: PROVIDER,
        calendarId: syncCalendarId,
        cause: error,
      });
    }
    // Graph answers 400 for ids it cannot decode, and for writes to a deleted event (which
    // sits in Deleted Items, outside any calendar). Neither event exists in the calendar.
    const missing =
      code === 'ErrorInvalidIdMalformed' ||
      (code === 'ErrorInvalidRequest' && /non-calendar folder/i.test(message));
    if (error.statusCode === 400 && missing && resource) {
      return new NotFoundError({
        provider: PROVIDER,
        resource: resource.type,
        id: resource.id,
        cause: error,
      });
    }
  }
  return mapAPICallError(error, { provider: PROVIDER, resource, eventId });
}

function graphError(body: string | undefined): { code: string; message: string } {
  try {
    const parsed = graphErrorSchema.safeParse(JSON.parse(body ?? ''));
    if (parsed.success) {
      return { code: parsed.data.error.code ?? '', message: parsed.data.error.message ?? '' };
    }
  } catch {
    // Not JSON: no Graph error code.
  }
  return { code: '', message: '' };
}
