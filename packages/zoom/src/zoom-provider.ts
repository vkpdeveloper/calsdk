import {
  APICallError,
  type CalendarProviderV1,
  type CallOptionsV1,
  type EventPatchV1,
  type EventTimeV1,
  type EventV1,
  InvalidArgumentError,
  InvalidResponseDataError,
  NotFoundError,
  type SendUpdatesV1,
  type SyncChangeV1,
  UnsupportedFunctionalityError,
  type WarningV1,
} from '@calsdk/provider';
import {
  type AccessToken,
  createJsonFetcher,
  eventTimeToInstant,
  type FetchFunction,
  formatZonedDateTime,
  isAllDay,
  isValidTimeZone,
  mapAPICallError,
  type QueryValue,
  urlPath,
} from '@calsdk/provider-utils';
import type { z } from 'zod';
import {
  fromMeeting,
  fromOccurrence,
  isDeleted,
  occurrencesOf,
  originalStartOf,
  parseEventId,
  seriesMinutes,
} from './convert-meeting';
import { isoSeconds, toZoomRecurrence } from './convert-recurrence';
import { hashOf, pageToken as pageTokens, syncCursor } from './tokens';
import {
  type Meeting,
  meetingListSchema,
  meetingSchema,
  RECURRING,
  SCHEDULED,
  userSchema,
} from './zoom-api';
import type { ZoomProviderTypes } from './zoom-options';

export type ZoomSettings = {
  /**
   * A Zoom OAuth access token, or a function returning a fresh one per request. Tokens of a
   * Server-to-Server OAuth app last an hour, so pass a function that mints them.
   */
  accessToken: AccessToken;
  /** Headers sent with every request. */
  headers?: Record<string, string | undefined>;
  /** Custom fetch, for example to add logging or to record requests in tests. */
  fetch?: FetchFunction;
};

export type ZoomProvider = CalendarProviderV1<'zoom', ZoomProviderTypes> &
  Required<Pick<CalendarProviderV1, 'doSyncEvents'>>;

const PROVIDER = 'zoom';
const BASE_URL = 'https://api.zoom.us/v2';
const MAX_PAGE_SIZE = 300;
const MINUTE = 60_000;
const MAX_MINUTES = 1440;

type Call = Pick<CallOptionsV1, 'headers' | 'abortSignal'>;
type Resource = { type: 'calendar' | 'event'; id: string };

/**
 * Creates a Zoom provider. Scheduled meetings are the events, all in the `'primary'`
 * calendar, and recurring meetings with a fixed time are series.
 *
 * @example
 * import { zoom } from '@calsdk/zoom';
 * const calendar = zoom({ accessToken: process.env.ZOOM_TOKEN });
 */
export function zoom(settings: ZoomSettings): ZoomProvider {
  const api = createJsonFetcher({
    baseURL: BASE_URL,
    accessToken: settings.accessToken,
    headers: settings.headers,
    fetch: settings.fetch,
  });

  async function request<Output>(
    call: Call,
    resource: Resource | undefined,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      path: string;
      query?: Record<string, QueryValue>;
      body?: unknown;
      schema?: z.ZodType<Output>;
    },
  ): Promise<Output> {
    try {
      const { value } = await api({
        ...options,
        headers: call.headers,
        abortSignal: call.abortSignal,
      });
      return value;
    } catch (error) {
      // Zoom answers ids that name no meeting or occurrence with a 400 and code 300.
      if (resource && isInvalidId(error)) {
        throw new NotFoundError({ provider: PROVIDER, resource: resource.type, id: resource.id });
      }
      throw mapAPICallError(error, { provider: PROVIDER, resource });
    }
  }

  /**
   * A single meeting or series, with every occurrence of a series, deleted ones too.
   * Instant meetings, personal meeting rooms and recurring meetings without a fixed time
   * have no times to show, so they read as missing.
   */
  async function readMeeting(call: Call, eventId: string, meetingId: string): Promise<Meeting> {
    const meeting = await request(
      call,
      { type: 'event', id: eventId },
      {
        method: 'GET',
        path: urlPath`/meetings/${meetingId}`,
        query: { show_previous_occurrences: true },
        schema: meetingSchema,
      },
    );
    if (meeting.type !== SCHEDULED && meeting.type !== RECURRING) {
      throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
    }
    return meeting;
  }

  /**
   * A meeting calsdk can show: like `readMeeting`, but series that start so far ahead that
   * Zoom has not scheduled their occurrences read as missing too.
   */
  async function getMeeting(call: Call, eventId: string, meetingId: string): Promise<Meeting> {
    const meeting = await readMeeting(call, eventId, meetingId);
    if (!hasTimes(meeting)) {
      throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
    }
    return meeting;
  }

  async function getEvent(call: Call, eventId: string): Promise<EventV1> {
    const { meetingId, originalStart } = parseEventId(eventId);
    const meeting = await getMeeting(call, eventId, meetingId);
    if (originalStart === undefined) return fromMeeting(meeting, { details: true });
    return fromOccurrence(meeting, findOccurrence(meeting, eventId, originalStart), {
      details: true,
    });
  }

  /**
   * Every scheduled meeting: single meetings as listed, and series with their occurrences,
   * which listings leave out.
   */
  async function readMeetings(call: Call): Promise<Meeting[]> {
    const listed = new Map<number, Meeting>();
    const seen = new Set<string>();
    let next: string | undefined;
    do {
      const page = await request(
        call,
        { type: 'calendar', id: 'primary' },
        {
          method: 'GET',
          path: '/users/me/meetings',
          query: { type: 'scheduled', page_size: MAX_PAGE_SIZE, next_page_token: next },
          schema: meetingListSchema,
        },
      );
      for (const meeting of page.meetings) {
        // Listings leave out the occurrences of series, read below.
        if (meeting.type === SCHEDULED || meeting.type === RECURRING) {
          listed.set(meeting.id, meeting);
        }
      }
      next = page.next_page_token || undefined;
      if (next !== undefined) {
        // A page token returned twice would loop forever.
        if (seen.has(next)) {
          throw new InvalidResponseDataError({
            data: next,
            message: 'Zoom returned the same page token twice.',
          });
        }
        seen.add(next);
      }
    } while (next !== undefined);
    // One series at a time, as Zoom limits requests per second and an account can have
    // many series.
    const meetings: Meeting[] = [];
    for (const meeting of listed.values()) {
      if (meeting.type !== RECURRING) {
        meetings.push(meeting);
        continue;
      }
      try {
        meetings.push(await getMeeting(call, String(meeting.id), String(meeting.id)));
      } catch (error) {
        // Deleted since it was listed, or not scheduled yet.
        if (!NotFoundError.isInstance(error)) throw error;
      }
    }
    return meetings;
  }

  /** Changes a whole meeting or series, then reads it back. */
  async function updateMeeting(
    call: Call,
    eventId: string,
    meeting: Meeting,
    patch: EventPatchV1,
    warnings: WarningV1[],
  ): Promise<EventV1> {
    const current = fromMeeting(meeting, { details: true });
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.topic = patch.title ?? '';
    if (patch.description !== undefined) body.agenda = patch.description ?? '';
    if (patch.attendees !== undefined) {
      body.settings = { meeting_invitees: invitees(patch.attendees ?? []) };
    }
    const moved = patch.start !== undefined || patch.end !== undefined;
    const timing = meetingTiming(patch.start ?? current.start, patch.end ?? current.end);
    if (moved) {
      body.start_time = isoSeconds(timing.start);
      body.duration = timing.minutes;
      body.timezone = timing.timeZone;
    }
    if (current.recurrence && (patch.recurrence === null || patch.recurrence?.length === 0)) {
      throw unsupported(
        'ending a series',
        'Zoom cannot turn a series into a single meeting. Delete it and create a new one.',
      );
    }
    // Zoom takes the whole pattern again whenever a series moves, and then schedules every
    // occurrence anew: ones deleted, moved or resized on their own come back as they were.
    const restored =
      moved &&
      current.recurrence !== undefined &&
      (meeting.occurrences ?? []).some(
        (occurrence) =>
          isDeleted(occurrence) ||
          fromOccurrence(meeting, occurrence, { details: false }).kind === 'exception',
      );
    const lines = patch.recurrence?.length
      ? patch.recurrence
      : moved && current.recurrence?.filter((line) => !/^EXDATE[:;]/i.test(line));
    if (lines) {
      const deleted = moved
        ? []
        : (meeting.occurrences ?? []).filter(isDeleted).map(originalStartOf);
      body.type = RECURRING;
      body.recurrence = toZoomRecurrence(lines, {
        start: timing.start,
        timeZone: timing.timeZone,
        deleted,
      });
    }
    if (Object.keys(body).length === 0) return current;
    const path = urlPath`/meetings/${String(meeting.id)}`;
    await request(call, { type: 'event', id: eventId }, { method: 'PATCH', path, body });
    const updated = await readMeeting(call, eventId, String(meeting.id));
    if (!hasTimes(updated)) {
      // Moved so far ahead that Zoom schedules none of its meetings: put it back, so it
      // does not disappear from calsdk.
      const series = meeting.type === RECURRING;
      await request(
        call,
        { type: 'event', id: eventId },
        {
          method: 'PATCH',
          path,
          body: {
            topic: meeting.topic ?? '',
            agenda: meeting.agenda ?? '',
            settings: { meeting_invitees: meeting.settings?.meeting_invitees ?? [] },
            type: meeting.type,
            start_time: isoSeconds(eventTimeToInstant(current.start)),
            duration: series ? seriesMinutes(meeting) : meeting.duration,
            timezone: meeting.timezone ?? undefined,
            recurrence: series ? meeting.recurrence : undefined,
          },
        },
      );
      throw unsupported(
        'recurrence',
        'Zoom does not schedule the meetings of a series that starts this far ahead, so the change was undone.',
      );
    }
    if (restored) {
      warnings.push({
        type: 'other',
        message:
          'Zoom restored the meetings of the series that were deleted, moved or resized on their own, as it does when a series moves.',
      });
    }
    return fromMeeting(updated, { details: true });
  }

  return {
    specificationVersion: 'v1',
    provider: PROVIDER,
    capabilities: {
      events: {
        details: true,
        allDay: false,
        recurrence: {
          condition:
            'Zoom repeats meetings daily, weekly on set weekdays, or monthly on a day or an nth weekday, for up to 60 meetings or until a date. One meeting of a series can only be moved, resized or deleted.',
        },
        recurrenceScopeThisAndFollowing: false,
        serverSideExpansion: true,
        attendees: true,
        conference: true,
        reminders: false,
        color: false,
        etag: false,
        search: false,
      },
      freeBusy: false,
      sync: true,
      webhooks: false,
    },

    async doListCalendars(call) {
      const me = await request(call, undefined, {
        method: 'GET',
        path: '/users/me',
        schema: userSchema,
      });
      return {
        calendars: [
          {
            id: 'primary',
            name: 'Zoom meetings',
            timeZone: me.timezone && isValidTimeZone(me.timezone) ? me.timezone : undefined,
            isPrimary: true,
            accessRole: 'owner',
          },
        ],
        warnings: [],
      };
    },

    async doGetEvent({ calendarId, eventId, ...call }) {
      assertPrimary(calendarId);
      return { event: await getEvent(call, eventId), warnings: [] };
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
        throw unsupported(
          'event search',
          'Zoom cannot search meetings. Filter the listed events instead.',
        );
      }
      assertPrimary(calendarId);
      const after = pageToken === undefined ? undefined : pageTokens.decode(pageToken);
      const min = Date.parse(timeMin);
      const max = Date.parse(timeMax);
      const matching: { event: EventV1; start: number }[] = [];
      for (const meeting of await readMeetings(call)) {
        const occurrences =
          meeting.type === RECURRING ? occurrencesOf(meeting, { details: false }) : [];
        if (meeting.type === RECURRING && expandRecurring) {
          for (const event of occurrences) {
            if (overlaps(event.start, event.end, min, max)) {
              matching.push({ event, start: eventTimeToInstant(event.start) });
            }
          }
          continue;
        }
        const event = fromMeeting(meeting, { details: false });
        // A series is in the window when one of its meetings is.
        const inWindow =
          meeting.type === RECURRING
            ? occurrences.some((occurrence) => overlaps(occurrence.start, occurrence.end, min, max))
            : overlaps(event.start, event.end, min, max);
        if (inWindow) matching.push({ event, start: eventTimeToInstant(event.start) });
      }
      matching.sort((a, b) => a.start - b.start || compare(a.event.id, b.event.id));
      const remaining = after
        ? matching.filter(
            ({ event, start }) =>
              start > after.start || (start === after.start && compare(event.id, after.id) > 0),
          )
        : matching;
      const page = remaining.slice(0, pageSize ?? remaining.length);
      const last = page.at(-1);
      return {
        events: page.map(({ event }) => event),
        nextPageToken:
          last && page.length < remaining.length
            ? pageTokens.encode({ start: last.start, id: last.event.id })
            : undefined,
        warnings: [],
      };
    },

    async doCreateEvent({ calendarId, event, sendUpdates, ...call }) {
      assertPrimary(calendarId);
      if (isAllDay(event.start) || isAllDay(event.end)) throw unsupported('all-day events');
      const { start, minutes, timeZone } = meetingTiming(event.start, event.end);
      const warnings = ignoredFields(event);
      warnSendUpdates(sendUpdates, warnings);
      const recurrence = event.recurrence?.length
        ? toZoomRecurrence(event.recurrence, { start, timeZone })
        : undefined;
      const created = await request(
        call,
        { type: 'calendar', id: calendarId },
        {
          method: 'POST',
          path: '/users/me/meetings',
          body: {
            topic: event.title,
            agenda: event.description,
            type: recurrence ? RECURRING : SCHEDULED,
            start_time: isoSeconds(start),
            timezone: timeZone,
            duration: minutes,
            recurrence,
            settings: event.attendees?.length
              ? { meeting_invitees: invitees(event.attendees) }
              : undefined,
          },
          schema: meetingSchema,
        },
      );
      if (!hasTimes(created)) {
        await request(
          call,
          { type: 'event', id: String(created.id) },
          { method: 'DELETE', path: urlPath`/meetings/${String(created.id)}` },
        );
        throw unsupported(
          'recurrence',
          'Zoom does not schedule the meetings of a series that starts this far ahead.',
        );
      }
      return { event: await getEvent(call, String(created.id)), warnings };
    },

    async doUpdateEvent({ calendarId, eventId, patch, scope, ifMatch, sendUpdates, ...call }) {
      assertPrimary(calendarId);
      if (ifMatch !== undefined) throw unsupported('conditional updates');
      if (scope === 'thisAndFollowing') throw unsupported('updating this and following meetings');
      const warnings = ignoredFields(patch);
      warnSendUpdates(sendUpdates, warnings);
      const { meetingId, originalStart } = parseEventId(eventId);
      const meeting = await getMeeting(call, eventId, meetingId);
      if (originalStart === undefined) {
        return { event: await updateMeeting(call, eventId, meeting, patch, warnings), warnings };
      }

      const occurrence = findOccurrence(meeting, eventId, originalStart);
      const instance = fromOccurrence(meeting, occurrence, { details: true });
      if (scope === 'all') {
        // The series moves by as much as this meeting would.
        const series = fromMeeting(meeting, { details: true });
        let seriesPatch = patch;
        if (patch.start !== undefined || patch.end !== undefined) {
          const { start, minutes, timeZone } = meetingTiming(
            patch.start ?? instance.start,
            patch.end ?? instance.end,
          );
          const seriesStart =
            eventTimeToInstant(series.start) + start - eventTimeToInstant(instance.start);
          seriesPatch = {
            ...patch,
            start: zoned(seriesStart, timeZone),
            end: zoned(seriesStart + minutes * MINUTE, timeZone),
          };
        }
        return {
          event: await updateMeeting(call, eventId, meeting, seriesPatch, warnings),
          warnings,
        };
      }

      const fields = (Object.keys(patch) as (keyof EventPatchV1)[]).filter(
        (field) => field !== 'start' && field !== 'end' && patch[field] !== undefined,
      );
      if (fields.length > 0) {
        throw unsupported(
          'changing one meeting of a series',
          `Zoom can only move or resize one meeting of a series. Change ${fields.join(', ')} on the whole series with scope 'all'.`,
        );
      }
      if (patch.start !== undefined || patch.end !== undefined) {
        const { start, minutes } = meetingTiming(
          patch.start ?? instance.start,
          patch.end ?? instance.end,
        );
        await request(
          call,
          { type: 'event', id: eventId },
          {
            method: 'PATCH',
            path: urlPath`/meetings/${meetingId}`,
            query: { occurrence_id: occurrence.occurrence_id },
            body: { start_time: isoSeconds(start), duration: minutes },
          },
        );
      }
      return { event: await getEvent(call, eventId), warnings };
    },

    async doDeleteEvent({ calendarId, eventId, scope, ifMatch, sendUpdates, ...call }) {
      assertPrimary(calendarId);
      if (ifMatch !== undefined) throw unsupported('conditional deletes');
      if (scope === 'thisAndFollowing') throw unsupported('deleting this and following meetings');
      const warnings: WarningV1[] = [];
      warnSendUpdates(sendUpdates, warnings);
      const { meetingId, originalStart } = parseEventId(eventId);
      // Reads first, so a meeting calsdk does not show, or an occurrence deleted before,
      // reads as missing. A whole series Zoom has not scheduled yet can still be deleted.
      const meeting =
        originalStart === undefined
          ? await readMeeting(call, eventId, meetingId)
          : await getMeeting(call, eventId, meetingId);
      const occurrence =
        originalStart === undefined ? undefined : findOccurrence(meeting, eventId, originalStart);
      await request(
        call,
        { type: 'event', id: eventId },
        {
          method: 'DELETE',
          path: urlPath`/meetings/${meetingId}`,
          query: { occurrence_id: scope === 'all' ? undefined : occurrence?.occurrence_id },
        },
      );
      return { warnings };
    },

    async doSyncEvents({ calendarId, cursor, pageToken, ...call }) {
      assertPrimary(calendarId);
      if (pageToken !== undefined) {
        throw new InvalidArgumentError({
          argument: 'pageToken',
          message: 'The Zoom provider returns every change on one page.',
        });
      }
      const previous =
        cursor === undefined
          ? undefined
          : new Map(syncCursor.decode(cursor).events.map(([id, hash, end]) => [id, { hash, end }]));
      const meetings = await readMeetings(call);
      const seen = new Map<string, [hash: string, end: number]>();
      // Occurrences that were not changed, in case one the last sync saw changed back.
      const plain = new Map<string, EventV1>();
      const changes: SyncChangeV1[] = [];
      const consider = (event: EventV1, end = eventTimeToInstant(event.end)) => {
        const hash = hashOf(JSON.stringify(event));
        seen.set(event.id, [hash, end]);
        if (previous?.get(event.id)?.hash !== hash) changes.push({ type: 'upsert', event });
      };
      for (const meeting of meetings) {
        const event = fromMeeting(meeting, { details: false });
        if (meeting.type !== RECURRING) {
          consider(event);
          continue;
        }
        const occurrences = occurrencesOf(meeting, { details: false });
        // A series lasts until its last meeting ends.
        const last = occurrences.at(-1);
        consider(event, last ? eventTimeToInstant(last.end) : undefined);
        for (const occurrence of occurrences) {
          if (occurrence.kind === 'exception') consider(occurrence);
          else plain.set(occurrence.id, occurrence);
        }
      }
      const now = Date.now();
      for (const [eventId, { end }] of previous ?? []) {
        if (seen.has(eventId)) continue;
        const occurrence = plain.get(eventId);
        if (occurrence) changes.push({ type: 'upsert', event: occurrence });
        // Zoom stops listing meetings some time after they end. Those were not deleted.
        else if (end > now) changes.push({ type: 'delete', eventId });
      }
      return {
        changes,
        nextCursor: syncCursor.encode({
          events: [...seen].map(([id, [hash, end]]) => [id, hash, end]),
        }),
        warnings: [],
      };
    },
  };
}

/** Whether calsdk can show `meeting`: a single meeting, or a series with occurrences. */
function hasTimes(meeting: Meeting): boolean {
  if (meeting.type === SCHEDULED) return true;
  return meeting.type === RECURRING && (meeting.occurrences?.length ?? 0) > 0;
}

/** The occurrence of a series that originally started at `originalStart`, if not deleted. */
function findOccurrence(meeting: Meeting, eventId: string, originalStart: number) {
  const occurrence = (meeting.occurrences ?? []).find(
    (item) => originalStartOf(item) === originalStart && !isDeleted(item),
  );
  if (meeting.type !== RECURRING || !occurrence) {
    throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
  }
  return occurrence;
}

/** The start and length of a meeting, which Zoom keeps in whole minutes up to a day. */
function meetingTiming(start: EventTimeV1, end: EventTimeV1) {
  if (isAllDay(start) || isAllDay(end)) throw unsupported('all-day events');
  const startInstant = eventTimeToInstant(start);
  const minutes = (eventTimeToInstant(end) - startInstant) / MINUTE;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    throw new InvalidArgumentError({
      argument: 'event.end',
      message: `Zoom meetings last whole minutes, from 1 minute to 24 hours, not ${minutes} minutes.`,
    });
  }
  return { start: startInstant, minutes, timeZone: start.timeZone };
}

function zoned(instant: number, timeZone: string): EventTimeV1 {
  return { dateTime: formatZonedDateTime(instant, timeZone), timeZone };
}

function overlaps(start: EventTimeV1, end: EventTimeV1, min: number, max: number) {
  return eventTimeToInstant(end) > min && eventTimeToInstant(start) < max;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const invitees = (attendees: { email: string }[]) => attendees.map(({ email }) => ({ email }));

function isInvalidId(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.statusCode !== 400) return false;
  try {
    return (JSON.parse(error.responseBody ?? '') as { code?: unknown }).code === 300;
  } catch {
    return false;
  }
}

function assertPrimary(calendarId: string) {
  if (calendarId !== 'primary') {
    throw new NotFoundError({ provider: PROVIDER, resource: 'calendar', id: calendarId });
  }
}

function unsupported(functionality: string, message?: string) {
  return new UnsupportedFunctionalityError({ provider: PROVIDER, functionality, message });
}

// Fields a Zoom meeting has no place for.
const IGNORED = [
  ['location', 'Zoom meetings take place at their meeting link.'],
  ['visibility', 'Zoom meetings have no visibility setting.'],
  ['reminders', 'Zoom sends the reminders the account is set up with.'],
  ['color', 'Zoom meetings have no color.'],
] as const;

function ignoredFields(event: EventPatchV1): WarningV1[] {
  const warnings: WarningV1[] = [];
  for (const [feature, details] of IGNORED) {
    if (event[feature] != null) warnings.push({ type: 'unsupported', feature, details });
  }
  if (event.showAs === 'free') {
    warnings.push({
      type: 'unsupported',
      feature: 'showAs',
      details: 'Zoom meetings always block time.',
    });
  }
  if (event.createConference === false) {
    warnings.push({
      type: 'unsupported',
      feature: 'createConference',
      details: 'Every Zoom meeting has a meeting link.',
    });
  }
  if (event.attendees?.some((attendee) => attendee.optional || attendee.name)) {
    warnings.push({
      type: 'unsupported',
      feature: 'attendees',
      details: 'Zoom keeps only the email addresses of invitees.',
    });
  }
  return warnings;
}

function warnSendUpdates(sendUpdates: SendUpdatesV1 | undefined, warnings: WarningV1[]) {
  if (sendUpdates !== undefined && sendUpdates !== 'none') {
    warnings.push({
      type: 'unsupported',
      feature: 'sendUpdates',
      details: 'Zoom does not email invitees about meetings changed through its API.',
    });
  }
}
