import {
  type CalendarProviderV1,
  type CalendarV1,
  ConflictError,
  type EventInputV1,
  type EventPatchV1,
  type EventTimeV1,
  type EventV1,
  InvalidArgumentError,
  NotFoundError,
  type PersonV1,
  type SyncChangeV1,
  SyncCursorExpiredError,
  type UpdateScopeV1,
} from '@calsdk/provider';
import {
  addDaysToDate,
  eventTimeToInstant,
  formatExdates,
  formatICalDate,
  formatRRule,
  formatZonedDateTime,
  type ICalDate,
  instantToICalDate,
  isAllDay,
  isValidTimeZone,
  parseICalDate,
  parseRecurrence,
} from '@calsdk/provider-utils';
import {
  assertSupportedRecurrence,
  expandInRange,
  type Instance,
  instancesBetween,
} from './expand-recurrence';

export type MockCalendarSettings = {
  /**
   * Calendars to start with. The first one is primary unless another sets `isPrimary`.
   * Defaults to a single calendar with id `cal_1`.
   */
  calendars?: (Partial<CalendarV1> & { id: string })[];
  /** Events to start with, created in order through the same path as `doCreateEvent`. */
  events?: (EventInputV1 & { id?: string; calendarId?: string })[];
  /** Clock for `createdAt` / `updatedAt`. Defaults to the real time. */
  now?: () => Date;
  /** The authenticated user. Becomes the organizer of created events. */
  user?: PersonV1;
  /** Page size for list calls without `pageSize`, and for sync rounds. Defaults to 250. */
  defaultPageSize?: number;
};

// The mock reads no provider options and sets no metadata.
export type MockCalendarProvider = CalendarProviderV1<
  'mock',
  { options: Record<never, never>; eventMetadata: never }
> &
  Required<Pick<CalendarProviderV1, 'doSyncEvents'>> & {
    /** Current calendars. Copies: mutating them does not change the mock. */
    readonly calendars: CalendarV1[];
    /** Stored events: singles, series masters and modified instances (`exception`). Copies. */
    readonly events: EventV1[];
  };

const PROVIDER = 'mock';
const DAY_MS = 86_400_000;

type ChangeLogEntry = { seq: number; calendarId: string; eventId: string; deleted: boolean };

const clone = <T>(value: T): T => structuredClone(value);

/** Drops `undefined` values so stored events stay minimal. */
const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

const notFound = (id: string) => new NotFoundError({ provider: PROVIDER, resource: 'event', id });

/**
 * An in-memory calendar provider.
 *
 * Use it to try calsdk without credentials, to test app logic offline, and as
 * the reference implementation for provider authors. Ids are deterministic
 * (`evt_1`, `evt_2`, ...). Occurrence ids are `<seriesId>_<start>`, like Google's.
 *
 * @example
 * const calendar = mockCalendar({
 *   events: [{ title: 'Standup', start, end, recurrence: ['RRULE:FREQ=DAILY'] }],
 * });
 * const { events } = await listEvents({ calendar, timeMin, timeMax, expandRecurring: true });
 */
export function mockCalendar(settings: MockCalendarSettings = {}): MockCalendarProvider {
  const now = settings.now ?? (() => new Date());
  const user = settings.user ?? { email: 'me@example.com', name: 'Me' };
  const pageSizeDefault = settings.defaultPageSize ?? 250;

  const seededCalendars = settings.calendars ?? [{ id: 'cal_1' }];
  const hasExplicitPrimary = seededCalendars.some((calendar) => calendar.isPrimary);
  const calendars: CalendarV1[] = seededCalendars.map((calendar, index) => ({
    name: calendar.id,
    timeZone: 'UTC',
    accessRole: 'owner',
    ...calendar,
    isPrimary: calendar.isPrimary ?? (!hasExplicitPrimary && index === 0),
  }));

  // State of the fake remote calendar. The provider object itself stays stateless
  // from core's point of view: everything is reachable through `do*` calls.
  const events = new Map<string, EventV1>();
  const changeLog: ChangeLogEntry[] = [];
  let nextId = 1;
  let seq = 0;

  function newId() {
    // Seeded events may already use ids of the generated form.
    while (events.has(`evt_${nextId}`)) nextId++;
    return `evt_${nextId++}`;
  }

  function resolveCalendar(calendarId: string): CalendarV1 {
    const calendar =
      calendarId === 'primary'
        ? calendars.find((candidate) => candidate.isPrimary)
        : calendars.find((candidate) => candidate.id === calendarId);
    if (!calendar) {
      throw new NotFoundError({ provider: PROVIDER, resource: 'calendar', id: calendarId });
    }
    return calendar;
  }

  const zoneOf = (calendar: CalendarV1) => calendar.timeZone ?? 'UTC';
  const instantOf = (time: EventTimeV1, calendar: CalendarV1) =>
    eventTimeToInstant(time, zoneOf(calendar));
  const recurringOf = (series: EventV1) => ({
    start: series.start,
    end: series.end,
    recurrence: series.recurrence ?? [],
  });

  function save(event: EventV1) {
    const previous = events.get(event.id);
    const timestamp = now().toISOString();
    seq++;
    events.set(event.id, {
      ...compact(event),
      // The change sequence is unique across events, so an exception never reuses
      // the etag it inherited from its series.
      etag: `"${seq}"`,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    changeLog.push({ seq, calendarId: event.calendarId, eventId: event.id, deleted: false });
  }

  function remove(event: EventV1) {
    if (event.kind === 'series') {
      for (const exception of exceptionsOf(event.id)) remove(exception);
    }
    events.delete(event.id);
    changeLog.push({ seq: ++seq, calendarId: event.calendarId, eventId: event.id, deleted: true });
  }

  const exceptionsOf = (seriesId: string) =>
    [...events.values()].filter((event) => event.seriesId === seriesId);

  function occurrenceOf(series: EventV1, instance: Instance, calendar: CalendarV1): EventV1 {
    const { recurrence: _recurrence, ...fields } = series;
    const suffix = isAllDay(instance.start)
      ? formatICalDate({ type: 'date', date: instance.start.date })
      : formatICalDate(instantToICalDate(instantOf(instance.start, calendar)));
    return {
      ...fields,
      id: `${series.id}_${suffix}`,
      kind: 'occurrence',
      seriesId: series.id,
      originalStart: instance.start,
      start: instance.start,
      end: instance.end,
    };
  }

  /** Instances of a series overlapping a range, with stored exceptions in place of their occurrences. */
  function instancesOf(
    series: EventV1,
    calendar: CalendarV1,
    rangeStart: number,
    rangeEnd: number,
  ) {
    const exceptions = exceptionsOf(series.id);
    const exceptionIds = new Set(exceptions.map((exception) => exception.id));
    const occurrences = expandInRange(recurringOf(series), zoneOf(calendar), rangeStart, rangeEnd)
      .map((instance) => occurrenceOf(series, instance, calendar))
      .filter((occurrence) => !exceptionIds.has(occurrence.id));
    // Exceptions can be moved in or out of the range, so check their own times.
    return [
      ...occurrences,
      ...exceptions.filter((exception) => overlaps(exception, calendar, rangeStart, rangeEnd)),
    ];
  }

  const overlaps = (event: EventV1, calendar: CalendarV1, rangeStart: number, rangeEnd: number) =>
    instantOf(event.end, calendar) > rangeStart && instantOf(event.start, calendar) < rangeEnd;

  /** Finds a stored event, or computes an unmodified occurrence from its id. */
  function findEvent(calendar: CalendarV1, eventId: string): EventV1 {
    const stored = events.get(eventId);
    if (stored) {
      if (stored.calendarId !== calendar.id) throw notFound(eventId);
      return stored;
    }

    const separator = eventId.lastIndexOf('_');
    const series = separator > 0 ? events.get(eventId.slice(0, separator)) : undefined;
    if (series?.kind !== 'series' || series.calendarId !== calendar.id) throw notFound(eventId);

    // The suffix is the UTC start (timed) or the date (all-day). A date is up to a
    // day away from the instant in the calendar's zone.
    let start: number;
    try {
      start = eventTimeToInstant(occurrenceStartOf(eventId.slice(separator + 1)), 'UTC');
    } catch {
      throw notFound(eventId);
    }
    const occurrence = instancesBetween(
      recurringOf(series),
      zoneOf(calendar),
      start - DAY_MS,
      start + DAY_MS,
    )
      .map((instance) => occurrenceOf(series, instance, calendar))
      .find((candidate) => candidate.id === eventId);
    if (!occurrence) throw notFound(eventId);
    return occurrence;
  }

  function checkEtag(event: EventV1, ifMatch: string | undefined) {
    if (ifMatch !== undefined && ifMatch !== event.etag) {
      throw new ConflictError({ provider: PROVIDER, eventId: event.id });
    }
  }

  const conferenceFor = (eventId: string): EventV1['conference'] => ({
    provider: 'other',
    joinUrl: `https://meet.example.com/${eventId}`,
    id: eventId,
  });

  const toAttendees = (attendees: NonNullable<EventInputV1['attendees']>) =>
    attendees.map((attendee) =>
      compact({
        ...attendee,
        responseStatus:
          attendee.email === user.email ? ('accepted' as const) : ('needsAction' as const),
        self: attendee.email === user.email ? true : undefined,
      }),
    );

  function applyPatch(event: EventV1, patch: EventPatchV1): EventV1 {
    const next: EventV1 = { ...event };
    for (const [key, value] of Object.entries(patch) as [keyof EventPatchV1, unknown][]) {
      if (value === undefined) continue;
      if (key === 'createConference') {
        if (value === true) next.conference ??= conferenceFor(event.id);
        else delete next.conference;
      } else if (key === 'showAs') {
        next.showAs = (value as EventV1['showAs'] | null) ?? 'busy';
      } else if (key === 'attendees') {
        if (value === null) delete next.attendees;
        else next.attendees = toAttendees(value as NonNullable<EventInputV1['attendees']>);
      } else if (value === null) {
        delete next[key];
      } else {
        Object.assign(next, { [key]: clone(value) });
      }
    }
    if (next.recurrence?.length === 0) delete next.recurrence;
    return next;
  }

  function validateTimes(event: Pick<EventV1, 'start' | 'end'>, calendar: CalendarV1) {
    for (const key of ['start', 'end'] as const) {
      const time = event[key];
      if (
        (!isAllDay(time) && !isValidTimeZone(time.timeZone)) ||
        !Number.isFinite(instantOf(time, calendar))
      ) {
        throw new InvalidArgumentError({
          argument: `event.${key}`,
          message: 'Not a valid date, date-time or time zone.',
        });
      }
    }
    if (isAllDay(event.start) !== isAllDay(event.end)) {
      throw new InvalidArgumentError({
        argument: 'event.end',
        message:
          'start and end must both be all-day ({ date }) or both timed ({ dateTime, timeZone }).',
      });
    }
    if (instantOf(event.end, calendar) <= instantOf(event.start, calendar)) {
      throw new InvalidArgumentError({
        argument: 'event.end',
        message: 'end must be after start.',
      });
    }
  }

  /** Validates `input` and builds the event without storing it. */
  function buildEvent(calendar: CalendarV1, input: EventInputV1, id = newId()): EventV1 {
    if (events.has(id)) {
      throw new InvalidArgumentError({
        argument: 'event.id',
        message: `An event with id "${id}" already exists.`,
      });
    }
    const { createConference, attendees, showAs, recurrence, ...fields } = clone(input);
    const event: EventV1 = {
      ...fields,
      id,
      calendarId: calendar.id,
      kind: recurrence?.length ? 'series' : 'single',
      recurrence: recurrence?.length ? recurrence : undefined,
      status: 'confirmed',
      showAs: showAs ?? 'busy',
      organizer: { ...user, self: true },
      attendees: attendees ? toAttendees(attendees) : undefined,
      conference: createConference ? conferenceFor(id) : undefined,
    };
    validateTimes(event, calendar);
    if (event.recurrence) assertSupportedRecurrence(recurringOf(event));
    return event;
  }

  function createEvent(calendar: CalendarV1, input: EventInputV1, id?: string): EventV1 {
    const event = buildEvent(calendar, input, id);
    save(event);
    return events.get(event.id) as EventV1;
  }

  /** Removes exceptions whose original occurrence is no longer part of the series. */
  function dropOrphanedExceptions(series: EventV1, calendar: CalendarV1) {
    for (const exception of exceptionsOf(series.id)) {
      const originalStart = instantOf(exception.originalStart ?? exception.start, calendar);
      const stillThere =
        series.kind === 'series' &&
        instancesBetween(recurringOf(series), zoneOf(calendar), originalStart, originalStart + 1)
          .length > 0;
      if (!stillThere) remove(exception);
    }
  }

  /** The input that recreates `event`, used when splitting a series. */
  const toInput = (event: EventV1): EventInputV1 =>
    compact({
      title: event.title,
      description: event.description,
      location: event.location,
      start: event.start,
      end: event.end,
      recurrence: event.recurrence,
      showAs: event.showAs,
      visibility: event.visibility,
      attendees: event.attendees?.map(({ email, name, optional }) =>
        compact({ email, name, optional }),
      ),
      createConference: event.conference ? true : undefined,
      reminders: event.reminders,
      color: event.color,
    });

  /**
   * Ends a series with the last instance before `cut` (UNTIL replaces COUNT) and
   * drops exceptions from `cut` on. Returns false when no instance would be left.
   */
  function trimSeries(series: EventV1, cut: number, calendar: CalendarV1): boolean {
    const parsed = parseRecurrence(series.recurrence ?? []);
    if (!parsed.rrule) return false;

    const last = instancesBetween(
      recurringOf(series),
      zoneOf(calendar),
      instantOf(series.start, calendar),
      cut,
    ).at(-1);
    if (!last) return false;

    const { count: _count, ...rule } = parsed.rrule;
    const until: ICalDate = isAllDay(last.start)
      ? { type: 'date', date: last.start.date }
      : instantToICalDate(last.startInstant);
    save({
      ...series,
      recurrence: [formatRRule({ ...rule, until }), ...formatExdates(parsed.exdates)],
    });
    for (const exception of exceptionsOf(series.id)) {
      if (instantOf(exception.originalStart ?? exception.start, calendar) >= cut) remove(exception);
    }
    return true;
  }

  function seriesOf(instance: EventV1): EventV1 {
    const series = instance.seriesId ? events.get(instance.seriesId) : undefined;
    if (!series) throw notFound(instance.seriesId ?? instance.id);
    return series;
  }

  /** Moves `time` by the distance between `from` and `to`. */
  function shiftTime(time: EventTimeV1, from: EventTimeV1, to: EventTimeV1, calendar: CalendarV1) {
    if (isAllDay(time) && isAllDay(from) && isAllDay(to)) {
      const days = Math.round((Date.parse(to.date) - Date.parse(from.date)) / DAY_MS);
      return { date: addDaysToDate(time.date, days) };
    }
    if (!isAllDay(time) && !isAllDay(to)) {
      const delta = instantOf(to, calendar) - instantOf(from, calendar);
      return {
        dateTime: formatZonedDateTime(Date.parse(time.dateTime) + delta, to.timeZone),
        timeZone: to.timeZone,
      };
    }
    throw new InvalidArgumentError({
      argument: 'patch.start',
      message:
        'Switching a whole series between all-day and timed through one instance is not supported. Update the series id instead.',
    });
  }

  function updateInstance(
    calendar: CalendarV1,
    instance: EventV1,
    patch: EventPatchV1,
    scope: UpdateScopeV1,
  ): EventV1 {
    if (patch.recurrence !== undefined) {
      throw new InvalidArgumentError({
        argument: 'patch.recurrence',
        message:
          'Recurrence cannot be changed through a single instance. Update the series id instead.',
      });
    }
    const series = seriesOf(instance);
    const originalStart = instance.originalStart ?? instance.start;

    if (scope === 'this') {
      const next = applyPatch({ ...instance, kind: 'exception' }, patch);
      validateTimes(next, calendar);
      save(next);
      return events.get(next.id) as EventV1;
    }

    if (scope === 'all') {
      const { start, end, ...rest } = patch;
      const next = applyPatch(series, rest);
      if (start) next.start = shiftTime(series.start, instance.start, start, calendar);
      if (end) next.end = shiftTime(series.end, instance.end, end, calendar);
      validateTimes(next, calendar);
      save(next);
      dropOrphanedExceptions(next, calendar);
      return events.get(series.id) as EventV1;
    }

    // thisAndFollowing: end the old series before this instance, start a new one at it.
    const cut = instantOf(originalStart, calendar);
    const parsed = parseRecurrence(series.recurrence ?? []);
    let remaining = parsed.rrule?.count;
    if (remaining !== undefined) {
      const seriesStart = instantOf(series.start, calendar);
      remaining -= instancesBetween(recurringOf(series), zoneOf(calendar), seriesStart, cut, {
        includeExcluded: true,
      }).length;
    }
    const rule = parsed.rrule && { ...parsed.rrule, count: remaining };
    const anchored = {
      ...series,
      start: originalStart,
      end: shiftTime(series.end, series.start, originalStart, calendar),
      recurrence: rule ? [formatRRule(rule)] : undefined,
    };
    // Validate the new series before touching the old one, so a bad patch changes nothing.
    const next = buildEvent(calendar, toInput(applyPatch(anchored, patch)));
    if (!trimSeries(series, cut, calendar)) remove(series);
    save(next);
    return events.get(next.id) as EventV1;
  }

  function deleteInstance(calendar: CalendarV1, instance: EventV1, scope: UpdateScopeV1) {
    const series = seriesOf(instance);
    const originalStart = instance.originalStart ?? instance.start;

    if (scope === 'all') {
      remove(series);
    } else if (scope === 'thisAndFollowing') {
      if (!trimSeries(series, instantOf(originalStart, calendar), calendar)) remove(series);
    } else {
      const exdate: ICalDate = isAllDay(originalStart)
        ? { type: 'date', date: originalStart.date }
        : instantToICalDate(instantOf(originalStart, calendar));
      save({ ...series, recurrence: [...(series.recurrence ?? []), ...formatExdates([exdate])] });
      if (events.has(instance.id)) remove(instance);
    }
  }

  for (const { id, calendarId, ...input } of settings.events ?? []) {
    createEvent(resolveCalendar(calendarId ?? 'primary'), input, id);
  }

  return {
    specificationVersion: 'v1',
    provider: PROVIDER,
    capabilities: {
      events: {
        details: true,
        allDay: true,
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
      // No native free/busy: core computes it from events, which exercises that fallback.
      freeBusy: false,
      sync: true,
      webhooks: false,
    },

    get calendars() {
      return clone(calendars);
    },

    get events() {
      return clone([...events.values()]);
    },

    async doListCalendars() {
      return { calendars: clone(calendars), warnings: [] };
    },

    async doGetEvent({ calendarId, eventId }) {
      return { event: clone(findEvent(resolveCalendar(calendarId), eventId)), warnings: [] };
    },

    async doListEvents({
      calendarId,
      timeMin,
      timeMax,
      expandRecurring,
      query,
      pageSize,
      pageToken,
    }) {
      const calendar = resolveCalendar(calendarId);
      const rangeStart = Date.parse(timeMin);
      const rangeEnd = Date.parse(timeMax);

      let matches: EventV1[] = [];
      for (const event of events.values()) {
        if (event.calendarId !== calendar.id || event.kind === 'exception') continue;
        if (event.kind === 'single') {
          if (overlaps(event, calendar, rangeStart, rangeEnd)) matches.push(event);
          continue;
        }
        const instances = instancesOf(event, calendar, rangeStart, rangeEnd);
        if (expandRecurring) matches.push(...instances);
        else if (instances.length > 0) matches.push(event);
      }

      if (query) {
        const needle = query.toLowerCase();
        matches = matches.filter((event) =>
          [event.title, event.description, event.location].some((field) =>
            field?.toLowerCase().includes(needle),
          ),
        );
      }
      matches.sort(
        (a, b) =>
          instantOf(a.start, calendar) - instantOf(b.start, calendar) || a.id.localeCompare(b.id),
      );

      const offset = parseOffset(pageToken);
      const size = pageSize ?? pageSizeDefault;
      const hasMore = offset + size < matches.length;
      return {
        events: clone(matches.slice(offset, offset + size)),
        nextPageToken: hasMore ? String(offset + size) : undefined,
        warnings: [],
      };
    },

    async doCreateEvent({ calendarId, event }) {
      return { event: clone(createEvent(resolveCalendar(calendarId), event)), warnings: [] };
    },

    async doUpdateEvent({ calendarId, eventId, patch, scope = 'this', ifMatch }) {
      const calendar = resolveCalendar(calendarId);
      const event = findEvent(calendar, eventId);
      checkEtag(event, ifMatch);

      if (event.kind === 'occurrence' || event.kind === 'exception') {
        return { event: clone(updateInstance(calendar, event, patch, scope)), warnings: [] };
      }

      const next = applyPatch(event, patch);
      next.kind = next.recurrence ? 'series' : 'single';
      validateTimes(next, calendar);
      if (next.recurrence) assertSupportedRecurrence(recurringOf(next));
      save(next);
      if (event.kind === 'series') dropOrphanedExceptions(next, calendar);
      return { event: clone(events.get(event.id) as EventV1), warnings: [] };
    },

    async doDeleteEvent({ calendarId, eventId, scope = 'this', ifMatch }) {
      const calendar = resolveCalendar(calendarId);
      const event = findEvent(calendar, eventId);
      checkEtag(event, ifMatch);

      if (event.kind === 'occurrence' || event.kind === 'exception') {
        deleteInstance(calendar, event, scope);
      } else {
        remove(event);
      }
      return { warnings: [] };
    },

    async doSyncEvents({ calendarId, cursor, pageToken }) {
      const calendar = resolveCalendar(calendarId);
      // A sync round covers the change log in (from, to]. Both travel in the page
      // token so every page of the round sees the same window.
      const round = pageToken === undefined ? undefined : parseSyncPageToken(pageToken);
      const from =
        round?.from ?? (cursor === undefined ? 0 : parseCursor(cursor, calendar.id, seq));
      const to = round?.to ?? seq;
      const offset = round?.offset ?? 0;

      // Latest change per event within the window, in the order of that change. The
      // window's log entries never change, so every page of a round sees the same list
      // even when events change mid-round. Changes after `to` come in the next round.
      const latest = new Map<string, ChangeLogEntry>();
      for (const entry of changeLog) {
        if (entry.seq > from && entry.seq <= to && entry.calendarId === calendar.id) {
          latest.delete(entry.eventId);
          latest.set(entry.eventId, entry);
        }
      }

      const changes: SyncChangeV1[] = [];
      for (const { eventId, deleted } of latest.values()) {
        // An initial sync only reports events that existed at the start of the round.
        if (deleted && from === 0) continue;
        const event = events.get(eventId);
        changes.push(event ? { type: 'upsert', event: clone(event) } : { type: 'delete', eventId });
      }

      const end = offset + pageSizeDefault;
      if (end < changes.length) {
        return {
          changes: changes.slice(offset, end),
          nextPageToken: `${from}:${to}:${end}`,
          warnings: [],
        };
      }
      return { changes: changes.slice(offset), nextCursor: `${calendar.id}:${to}`, warnings: [] };
    },
  };
}

function parseOffset(pageToken: string | undefined): number {
  if (pageToken === undefined) return 0;
  const offset = Number(pageToken);
  if (!/^\d+$/.test(pageToken) || !Number.isSafeInteger(offset)) {
    throw new InvalidArgumentError({
      argument: 'pageToken',
      message: 'Not a page token returned by the mock provider.',
    });
  }
  return offset;
}

function parseSyncPageToken(pageToken: string) {
  const match = /^(\d+):(\d+):(\d+)$/.exec(pageToken);
  if (!match) {
    throw new InvalidArgumentError({
      argument: 'pageToken',
      message: 'Not a sync page token returned by the mock provider.',
    });
  }
  return { from: Number(match[1]), to: Number(match[2]), offset: Number(match[3]) };
}

function parseCursor(cursor: string, calendarId: string, currentSeq: number): number {
  const separator = cursor.lastIndexOf(':');
  const value = cursor.slice(separator + 1);
  if (
    separator === -1 ||
    cursor.slice(0, separator) !== calendarId ||
    !/^\d+$/.test(value) ||
    Number(value) > currentSeq
  ) {
    throw new SyncCursorExpiredError({ provider: PROVIDER, calendarId });
  }
  return Number(value);
}

/** The start encoded in an occurrence id suffix: `20261103` or `20261103T043000Z`. */
function occurrenceStartOf(suffix: string): EventTimeV1 {
  const value = parseICalDate(suffix);
  return value.type === 'date'
    ? { date: value.date }
    : { dateTime: `${value.local}Z`, timeZone: 'UTC' };
}
