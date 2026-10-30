import {
  APICallError,
  type CalendarProviderV1,
  type CalendarV1,
  type CallOptionsV1,
  CalsdkError,
  ConflictError,
  type EventTimeV1,
  type FreeBusyResultV1,
  InvalidArgumentError,
  NotFoundError,
  RateLimitError,
  type SyncChangeV1,
  SyncCursorExpiredError,
  type WarningV1,
} from '@calsdk/provider';
import {
  type AccessToken,
  addDaysToDate,
  createJsonFetcher,
  eventTimeToInstant,
  type FetchFunction,
  formatExdates,
  formatRdates,
  formatRRule,
  type ICalDate,
  instantToICalDate,
  isAllDay,
  localToInstant,
  mapAPICallError,
  type ParsedRecurrence,
  parseLocalDateTime,
  parseProviderOptions,
  parseRecurrence,
  parseRetryAfterMs,
  type QueryValue,
  urlPath,
} from '@calsdk/provider-utils';
import type { z } from 'zod';
import {
  fromGoogleEvent,
  fromGoogleTime,
  type GoogleEventWrite,
  needsCalendarZone,
  toGoogleTime,
  toGoogleWrite,
} from './convert-event';
import {
  type GoogleEvent,
  googleCalendarListSchema,
  googleCalendarSchema,
  googleErrorSchema,
  googleEventListSchema,
  googleEventSchema,
  googleFreeBusySchema,
} from './google-api';
import { googleEventOptionsSchema, googleListEventsOptionsSchema } from './google-options';
import { moveRecurrence, moveTime, seriesMove } from './move-series';

export type GoogleCalendarSettings = {
  /** An OAuth access token with a Calendar scope, or a function returning a fresh one per request. */
  accessToken: AccessToken;
  /** Defaults to `https://www.googleapis.com/calendar/v3`. */
  baseURL?: string;
  /** Headers sent with every request. */
  headers?: Record<string, string | undefined>;
  /** Custom fetch, for example to add logging or to record requests in tests. */
  fetch?: FetchFunction;
};

export type GoogleCalendarProvider = CalendarProviderV1 &
  Required<Pick<CalendarProviderV1, 'doFreeBusy' | 'doSyncEvents'>>;

const PROVIDER = 'google';
const MAX_PAGE_SIZE = 2500;
// Google accepts at most 50 calendars per free/busy request.
const FREE_BUSY_BATCH = 50;
const DAY_MS = 86_400_000;
// Undoing a half-finished split gets its own deadline, independent of the caller's signal.
const CLEANUP_MS = 10_000;
const ACCESS_ROLES = new Set<string>(['owner', 'writer', 'reader', 'freeBusyReader']);

/**
 * Creates a Google Calendar provider.
 *
 * @example
 * import { google } from '@calsdk/google';
 * const calendar = google({ accessToken: () => getFreshToken() });
 */
export function google(settings: GoogleCalendarSettings): GoogleCalendarProvider {
  const api = createJsonFetcher({
    baseURL: settings.baseURL ?? 'https://www.googleapis.com/calendar/v3',
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
        headers: { ...call.headers, ...options.headers },
        abortSignal: call.abortSignal,
      });
      return value;
    } catch (error) {
      throw mapGoogleError(error, context);
    }
  }

  const eventPath = (calendarId: string, eventId: string) =>
    urlPath`/calendars/${calendarId}/events/${eventId}`;

  /** Reads an event. Deleted events, which Google still returns as `cancelled`, are not found. */
  async function getRaw(call: Call, calendarId: string, eventId: string): Promise<GoogleEvent> {
    const resource = { type: 'event', id: eventId } as const;
    const raw = await request(
      call,
      // Reads precede conditional writes, so a 412 here is a conflict too.
      { resource, eventId },
      { method: 'GET', path: eventPath(calendarId, eventId), schema: googleEventSchema },
    );
    if (raw.status === 'cancelled') {
      throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
    }
    return raw;
  }

  async function calendarZone(call: Call, calendarId: string): Promise<string | undefined> {
    const calendar = await request(
      call,
      { resource: { type: 'calendar', id: calendarId } },
      { method: 'GET', path: urlPath`/calendars/${calendarId}`, schema: googleCalendarSchema },
    );
    return calendar.timeZone;
  }

  /**
   * Ids of modified instances among `instances`. Expanded listings do not mark them, but an
   * unexpanded listing returns modified instances as separate events, so one extra listing
   * over the instances' time span tells them apart.
   */
  async function exceptionIds(
    call: Call,
    calendarId: string,
    instances: GoogleEvent[],
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    if (instances.length === 0) return ids;
    const wanted = new Set(instances.map((instance) => instance.id));
    // A day of margin covers all-day times, whose instant depends on the calendar's zone.
    const instants = instances.flatMap((instance) =>
      [instance.start, instance.end].map((time) => eventTimeToInstant(fromGoogleTime(time))),
    );
    let pageToken: string | undefined;
    do {
      const page = await request(
        call,
        { resource: { type: 'calendar', id: calendarId } },
        {
          method: 'GET',
          path: urlPath`/calendars/${calendarId}/events`,
          query: {
            timeMin: new Date(Math.min(...instants) - DAY_MS).toISOString(),
            timeMax: new Date(Math.max(...instants) + DAY_MS).toISOString(),
            singleEvents: false,
            maxResults: MAX_PAGE_SIZE,
            pageToken,
          },
          schema: googleEventListSchema,
        },
      );
      for (const item of page.items ?? []) {
        if (item.recurringEventId !== undefined && wanted.has(item.id)) ids.add(item.id);
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined && ids.size < wanted.size);
    return ids;
  }

  /** Converts one event read on its own, looking up whatever Google left out. */
  async function toEvent(call: Call, calendarId: string, raw: GoogleEvent, isException?: boolean) {
    const timeZone = needsCalendarZone(raw) ? await calendarZone(call, calendarId) : undefined;
    const exception =
      isException ??
      (raw.recurringEventId !== undefined &&
        (await exceptionIds(call, calendarId, [raw])).has(raw.id));
    return fromGoogleEvent(raw, { calendarId, timeZone, isException: exception });
  }

  async function eventOptions(providerOptions: CallOptionsV1['providerOptions']) {
    return parseProviderOptions({
      provider: PROVIDER,
      providerOptions,
      schema: googleEventOptionsSchema,
    });
  }

  function assertEtag(raw: GoogleEvent, ifMatch: string | undefined) {
    if (ifMatch !== undefined && raw.etag !== ifMatch) {
      throw new ConflictError({ provider: PROVIDER, eventId: raw.id });
    }
  }

  async function createRaw(
    call: Call,
    calendarId: string,
    body: GoogleEventWrite & Record<string, unknown>,
    sendUpdates: string | undefined,
  ) {
    return request(
      call,
      { resource: { type: 'calendar', id: calendarId } },
      {
        method: 'POST',
        path: urlPath`/calendars/${calendarId}/events`,
        // Version 1 keeps existing conference data and allows creating Meet links.
        query: { conferenceDataVersion: 1, sendUpdates },
        body,
        schema: googleEventSchema,
      },
    );
  }

  async function patchRaw(
    call: Call,
    calendarId: string,
    eventId: string,
    body: GoogleEventWrite & Record<string, unknown>,
    { ifMatch, sendUpdates }: { ifMatch?: string; sendUpdates?: string },
  ) {
    return request(
      call,
      { resource: { type: 'event', id: eventId }, eventId },
      {
        method: 'PATCH',
        path: eventPath(calendarId, eventId),
        query: { conferenceDataVersion: 1, sendUpdates },
        body,
        headers: { 'if-match': ifMatch },
        schema: googleEventSchema,
      },
    );
  }

  async function deleteRaw(
    call: Call,
    calendarId: string,
    eventId: string,
    { ifMatch, sendUpdates }: { ifMatch?: string; sendUpdates?: string },
  ) {
    await request(
      call,
      { resource: { type: 'event', id: eventId }, eventId },
      {
        method: 'DELETE',
        path: eventPath(calendarId, eventId),
        query: { sendUpdates },
        headers: { 'if-match': ifMatch },
      },
    );
  }

  /**
   * How many of a `COUNT` series' positions come before `cut`. COUNT counts every position
   * the RRULE generates, including excluded ones. Google lists instances by their current
   * start, so the finite series is read whole and counted by original start. EXDATE
   * positions are not listed, and RDATEs are listed but are not positions.
   */
  async function positionsBefore(
    call: Call,
    calendarId: string,
    seriesId: string,
    { exdates, rdates }: ParsedRecurrence,
    zone: string,
    cut: number,
  ) {
    const positions = new Set<number>();
    let pageToken: string | undefined;
    do {
      const page = await request(
        call,
        { resource: { type: 'event', id: seriesId } },
        {
          method: 'GET',
          path: urlPath`/calendars/${calendarId}/events/${seriesId}/instances`,
          query: { showDeleted: true, maxResults: MAX_PAGE_SIZE, pageToken },
          schema: googleEventListSchema,
        },
      );
      for (const item of page.items ?? []) {
        positions.add(eventTimeToInstant(fromGoogleTime(item.originalStartTime ?? item.start)));
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
    for (const date of exdates) positions.add(icalInstant(date, zone));
    for (const date of rdates) positions.delete(icalInstant(date, zone));
    return [...positions].filter((position) => position < cut).length;
  }

  /**
   * Splits a series at `cut`: the master's rule gets an `UNTIL` just before it, and the
   * returned lines continue the rule from `cut` (with the remaining `COUNT`, if any).
   * `EXDATE` and `RDATE` values go to the half they fall in.
   */
  async function splitRecurrence(
    call: Call,
    calendarId: string,
    master: GoogleEvent,
    masterStart: EventTimeV1,
    cut: number,
  ) {
    const parsed = parseRecurrence(master.recurrence ?? []);
    const zone = isAllDay(masterStart) ? 'UTC' : masterStart.timeZone;
    const isBefore = (date: ICalDate) => icalInstant(date, zone) < cut;
    const rule = parsed.rrule;
    if (!rule) {
      throw new InvalidArgumentError({
        argument: 'scope',
        message: 'This series has no RRULE, so it cannot be split. Use scope "all" instead.',
      });
    }
    const { count, ...rest } = rule;
    const until: ICalDate = isAllDay(masterStart)
      ? { type: 'date', date: addDaysToDate(new Date(cut).toISOString().slice(0, 10), -1) }
      : instantToICalDate(cut - 1000);
    const remaining =
      count === undefined
        ? undefined
        : count - (await positionsBefore(call, calendarId, master.id, parsed, zone, cut));
    return {
      head: [
        formatRRule({ ...rest, until }),
        ...formatExdates(parsed.exdates.filter(isBefore)),
        ...formatRdates(parsed.rdates.filter(isBefore)),
        ...parsed.other,
      ],
      tail: [
        formatRRule({ ...rule, count: remaining }),
        ...formatExdates(parsed.exdates.filter((date) => !isBefore(date))),
        ...formatRdates(parsed.rdates.filter((date) => !isBefore(date))),
        ...parsed.other,
      ],
    };
  }

  /**
   * Google drops a series' deleted and edited occurrences when its start moves, and a new
   * series made by a split starts without them. Deleted ones from `from` on are kept as
   * EXDATE lines added to `lines`. Edited ones cannot be kept, so they get a warning.
   */
  async function keepExceptions(
    call: Call,
    calendarId: string,
    master: GoogleEvent,
    lines: readonly string[],
    from: number,
    warnings: WarningV1[],
  ) {
    if (master.iCalUID === undefined) return [...lines];
    const deleted: ICalDate[] = [];
    let edited = 0;
    let pageToken: string | undefined;
    do {
      // The series' iCalendar UID lists the master with its exceptions only.
      const page = await request(
        call,
        { resource: { type: 'calendar', id: calendarId } },
        {
          method: 'GET',
          path: urlPath`/calendars/${calendarId}/events`,
          query: {
            iCalUID: master.iCalUID,
            singleEvents: false,
            showDeleted: true,
            maxResults: MAX_PAGE_SIZE,
            pageToken,
          },
          schema: googleEventListSchema,
        },
      );
      for (const item of page.items ?? []) {
        if (item.recurringEventId !== master.id || !item.originalStartTime) continue;
        const original = fromGoogleTime(item.originalStartTime);
        const instant = eventTimeToInstant(original);
        if (instant < from) continue;
        if (item.status !== 'cancelled') edited++;
        else if (isAllDay(original)) deleted.push({ type: 'date', date: original.date });
        else deleted.push(instantToICalDate(instant));
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
    if (edited > 0) {
      warnings.push({
        type: 'compatibility',
        feature: 'scope',
        details: `${edited} edited occurrence(s) of the series lost their changes: Google resets them when a series moves or splits.`,
      });
    }
    return [...lines, ...formatExdates(deleted)];
  }

  /** The series of an instance, and where the instance falls in it. */
  async function seriesOf(call: Call, calendarId: string, instance: GoogleEvent) {
    const seriesId = instance.recurringEventId ?? instance.id;
    const master = await getRaw(call, calendarId, seriesId);
    const start = fromGoogleTime(master.start, master.start?.timeZone);
    const cut = eventTimeToInstant(fromGoogleTime(instance.originalStartTime ?? instance.start));
    return { master, start, cut, isFirst: cut <= eventTimeToInstant(start) };
  }

  return {
    specificationVersion: 'v1',
    provider: PROVIDER,
    capabilities: {
      events: {
        recurrence: true,
        recurrenceScopeThisAndFollowing: true,
        serverSideExpansion: true,
        attendees: true,
        conference: true,
        reminders: true,
        color: true,
        etag: true,
        search: true,
      },
      freeBusy: true,
      sync: true,
      webhooks: false,
    },

    async doListCalendars(call) {
      const calendars: CalendarV1[] = [];
      let pageToken: string | undefined;
      do {
        const page = await request(
          call,
          {},
          {
            method: 'GET',
            path: '/users/me/calendarList',
            query: { maxResults: 250, pageToken },
            schema: googleCalendarListSchema,
          },
        );
        for (const item of page.items ?? []) {
          calendars.push({
            id: item.id,
            name: item.summaryOverride ?? item.summary ?? item.id,
            description: item.description,
            timeZone: item.timeZone,
            color: item.backgroundColor?.toLowerCase(),
            isPrimary: item.primary === true,
            accessRole: ACCESS_ROLES.has(item.accessRole ?? '')
              ? (item.accessRole as CalendarV1['accessRole'])
              : 'reader',
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken !== undefined);
      return { calendars, warnings: [] };
    },

    async doGetEvent({ calendarId, eventId, ...call }) {
      const raw = await getRaw(call, calendarId, eventId);
      return { event: await toEvent(call, calendarId, raw), warnings: [] };
    },

    async doListEvents({
      calendarId,
      timeMin,
      timeMax,
      expandRecurring,
      query,
      pageSize,
      pageToken,
      providerOptions,
      ...call
    }) {
      const { options, warnings } = await parseProviderOptions({
        provider: PROVIDER,
        providerOptions,
        schema: googleListEventsOptionsSchema,
      });
      const page = await request(
        call,
        { resource: { type: 'calendar', id: calendarId } },
        {
          method: 'GET',
          path: urlPath`/calendars/${calendarId}/events`,
          query: {
            timeMin,
            timeMax,
            singleEvents: expandRecurring,
            orderBy: expandRecurring ? 'startTime' : undefined,
            q: query,
            maxResults: pageSize === undefined ? undefined : Math.min(pageSize, MAX_PAGE_SIZE),
            pageToken,
            eventTypes: options?.eventTypes,
          },
          schema: googleEventListSchema,
        },
      );
      // Unexpanded listings also return modified and deleted instances: the contract
      // only wants singles and series masters there.
      const items = (page.items ?? []).filter(
        (item) =>
          item.status !== 'cancelled' && (expandRecurring || item.recurringEventId === undefined),
      );
      const exceptions = await exceptionIds(
        call,
        calendarId,
        items.filter((item) => item.recurringEventId !== undefined),
      );
      return {
        events: items.map((item) =>
          fromGoogleEvent(item, {
            calendarId,
            timeZone: page.timeZone,
            isException: exceptions.has(item.id),
          }),
        ),
        nextPageToken: page.nextPageToken,
        warnings,
      };
    },

    async doCreateEvent({ calendarId, event, sendUpdates, providerOptions, ...call }) {
      const { options, warnings } = await eventOptions(providerOptions);
      const body = { ...toGoogleWrite(event, 'create', warnings), ...options };
      const raw = await createRaw(call, calendarId, body, sendUpdates);
      return { event: await toEvent(call, calendarId, raw, false), warnings };
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
      const body = { ...toGoogleWrite(patch, 'patch', warnings), ...options };
      // Read first: Google would revive a deleted event on PATCH, and the scope only
      // applies to instances.
      const current = await getRaw(call, calendarId, eventId);
      const isInstance = current.recurringEventId !== undefined;

      if (!isInstance || scope === 'this') {
        const raw = await patchRaw(call, calendarId, eventId, body, { ifMatch, sendUpdates });
        return { event: await toEvent(call, calendarId, raw, isInstance), warnings };
      }

      assertEtag(current, ifMatch);
      if (patch.recurrence !== undefined) {
        throw new InvalidArgumentError({
          argument: 'patch.recurrence',
          message:
            'Recurrence cannot be changed through a single instance. Update the series id instead.',
        });
      }
      const series = await seriesOf(call, calendarId, current);
      const instance = {
        start: fromGoogleTime(current.start, current.start?.timeZone),
        end: fromGoogleTime(current.end, current.end?.timeZone),
      };
      const end = fromGoogleTime(series.master.end, series.master.end?.timeZone);
      const zone = isAllDay(series.start) ? 'UTC' : series.start.timeZone;

      if (scope === 'all' || series.isFirst) {
        // Times move the whole series by the distance this instance moves, and its rule's
        // dates move with it.
        const shifted: GoogleEventWrite & Record<string, unknown> = { ...body };
        const move = patch.start && seriesMove(instance.start, patch.start, zone);
        if (move) shifted.start = toGoogleTime(moveTime(series.start, move), true);
        if (patch.end) {
          shifted.end = toGoogleTime(
            moveTime(end, seriesMove(instance.end, patch.end, zone)),
            true,
          );
        }
        if (move && move.ms !== 0 && series.master.recurrence) {
          const lines = await keepExceptions(
            call,
            calendarId,
            series.master,
            series.master.recurrence,
            Number.NEGATIVE_INFINITY,
            warnings,
          );
          shifted.recurrence = moveRecurrence(lines, series.start, move);
        }
        const raw = await patchRaw(call, calendarId, series.master.id, shifted, {
          ifMatch: series.master.etag,
          sendUpdates,
        });
        return { event: await toEvent(call, calendarId, raw, false), warnings };
      }

      // thisAndFollowing: a new series from this instance on, then end the old one before it.
      const { head, tail } = await splitRecurrence(
        call,
        calendarId,
        series.master,
        series.start,
        series.cut,
      );
      const originalStart = fromGoogleTime(
        current.originalStartTime ?? current.start,
        series.start.timeZone,
      );
      // A new start moves the tail's rule dates with it, so the same occurrences stay excluded.
      const move = patch.start && seriesMove(originalStart, patch.start, zone);
      const tailLines = await keepExceptions(
        call,
        calendarId,
        series.master,
        tail,
        series.cut,
        warnings,
      );
      const created = await createRaw(
        call,
        calendarId,
        {
          ...copyableFields(series.master),
          start: toGoogleTime(originalStart, false),
          end: toGoogleTime(moveTime(end, seriesMove(series.start, originalStart, zone)), false),
          recurrence: move ? moveRecurrence(tailLines, originalStart, move) : tailLines,
          ...body,
        },
        sendUpdates,
      );
      try {
        await patchRaw(
          call,
          calendarId,
          series.master.id,
          { recurrence: head },
          { ifMatch: series.master.etag, sendUpdates },
        );
      } catch (error) {
        // Undo the new series so the calendar is left as it was. The caller's signal may be
        // what failed, so the cleanup gets its own.
        const cleanup = { headers: call.headers, abortSignal: AbortSignal.timeout(CLEANUP_MS) };
        try {
          await deleteRaw(cleanup, calendarId, created.id, { sendUpdates: 'none' });
        } catch (cleanupError) {
          throw new CalsdkError({
            name: 'CalsdkError',
            message: `Splitting the series failed, and the new series "${created.id}" it created could not be removed. Delete it, then retry. Cleanup error: ${String(cleanupError)}`,
            cause: error,
          });
        }
        throw error;
      }
      return { event: await toEvent(call, calendarId, created, false), warnings };
    },

    async doDeleteEvent({ calendarId, eventId, scope = 'this', ifMatch, sendUpdates, ...call }) {
      if (scope === 'this') {
        await deleteRaw(call, calendarId, eventId, { ifMatch, sendUpdates });
        return { warnings: [] };
      }
      const current = await getRaw(call, calendarId, eventId);
      assertEtag(current, ifMatch);
      if (current.recurringEventId === undefined) {
        await deleteRaw(call, calendarId, eventId, { ifMatch, sendUpdates });
        return { warnings: [] };
      }
      const series = await seriesOf(call, calendarId, current);
      if (scope === 'all' || series.isFirst) {
        await deleteRaw(call, calendarId, series.master.id, {
          ifMatch: series.master.etag,
          sendUpdates,
        });
      } else {
        const { head } = await splitRecurrence(
          call,
          calendarId,
          series.master,
          series.start,
          series.cut,
        );
        await patchRaw(
          call,
          calendarId,
          series.master.id,
          { recurrence: head },
          { ifMatch: series.master.etag, sendUpdates },
        );
      }
      return { warnings: [] };
    },

    async doFreeBusy({ calendarIds, timeMin, timeMax, ...call }) {
      const calendars: FreeBusyResultV1['calendars'] = {};
      for (let index = 0; index < calendarIds.length; index += FREE_BUSY_BATCH) {
        const batch = calendarIds.slice(index, index + FREE_BUSY_BATCH);
        const result = await request(
          call,
          {},
          {
            method: 'POST',
            path: '/freeBusy',
            body: { timeMin, timeMax, items: batch.map((id) => ({ id })) },
            schema: googleFreeBusySchema,
          },
        );
        for (const id of batch) {
          const entry =
            result.calendars && Object.hasOwn(result.calendars, id)
              ? result.calendars[id]
              : undefined;
          const reasons = entry?.errors?.map((error) => error.reason) ?? [];
          calendars[id] = {
            busy: entry?.busy ?? [],
            ...(entry === undefined
              ? { error: 'Missing from the Google response.' }
              : reasons.length > 0 && {
                  error: `Google could not read it: ${reasons.join(', ')}.`,
                }),
          };
        }
      }
      return { calendars, warnings: [] };
    },

    async doSyncEvents({ calendarId, cursor, pageToken, ...call }) {
      const page = await request(
        call,
        { resource: { type: 'calendar', id: calendarId }, syncCalendarId: calendarId },
        {
          method: 'GET',
          path: urlPath`/calendars/${calendarId}/events`,
          query: { syncToken: cursor, pageToken, maxResults: MAX_PAGE_SIZE },
          schema: googleEventListSchema,
        },
      );
      // Unexpanded, so instances in a sync are always modified ones.
      const changes = (page.items ?? []).map(
        (item): SyncChangeV1 =>
          item.status === 'cancelled'
            ? { type: 'delete', eventId: item.id }
            : {
                type: 'upsert',
                event: fromGoogleEvent(item, {
                  calendarId,
                  timeZone: page.timeZone,
                  isException: true,
                }),
              },
      );
      return {
        changes,
        nextPageToken: page.nextPageToken,
        nextCursor: page.nextPageToken === undefined ? page.nextSyncToken : undefined,
        warnings: [],
      };
    },
  };
}

/** Fields a new series inherits when a series is split. */
function copyableFields(master: GoogleEvent): Record<string, unknown> {
  const {
    summary,
    description,
    location,
    colorId,
    transparency,
    visibility,
    attendees,
    reminders,
    extendedProperties,
    guestsCanModify,
    guestsCanInviteOthers,
    guestsCanSeeOtherGuests,
    conferenceData,
  } = master;
  return {
    summary,
    description,
    location,
    colorId,
    transparency,
    visibility,
    attendees,
    reminders,
    extendedProperties,
    guestsCanModify,
    guestsCanInviteOthers,
    guestsCanSeeOtherGuests,
    // Keeps the same meeting link on both halves of the series.
    conferenceData,
  };
}

function icalInstant(date: ICalDate, seriesZone: string): number {
  if (date.type === 'date') return Date.parse(`${date.date}T00:00:00Z`);
  const local = parseLocalDateTime(date.local);
  if (!local) return Number.NaN;
  return localToInstant(local, date.timeZone ?? seriesZone);
}

function mapGoogleError(
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
    // Google reports most rate limits as 403 with a reason.
    const reasons = errorReasons(error.responseBody);
    if (
      error.statusCode === 403 &&
      reasons.some((reason) => reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')
    ) {
      return new RateLimitError({
        provider: PROVIDER,
        retryAfterMs: parseRetryAfterMs(error.responseHeaders),
        cause: error,
      });
    }
    if (error.statusCode === 410 && syncCalendarId !== undefined) {
      return new SyncCursorExpiredError({
        provider: PROVIDER,
        calendarId: syncCalendarId,
        cause: error,
      });
    }
  }
  return mapAPICallError(error, { provider: PROVIDER, resource, eventId });
}

function errorReasons(body: string | undefined): string[] {
  try {
    const parsed = googleErrorSchema.safeParse(JSON.parse(body ?? ''));
    return parsed.success
      ? (parsed.data.error.errors ?? []).flatMap((error) => (error.reason ? [error.reason] : []))
      : [];
  } catch {
    return [];
  }
}
