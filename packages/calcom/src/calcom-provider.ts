import {
  type CalendarProviderV1,
  type CallOptionsV1,
  type EventPatchV1,
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
  isAllDay,
  isValidTimeZone,
  mapAPICallError,
  parseProviderOptions,
  type QueryValue,
  urlPath,
} from '@calsdk/provider-utils';
import type { z } from 'zod';
import {
  API_VERSIONS,
  type Booking,
  bookingListSchema,
  bookingOutputSchema,
  type EventType,
  eventTypeListSchema,
  eventTypeOutputSchema,
  meOutputSchema,
} from './calcom-api';
import {
  type CalcomProviderTypes,
  calcomCreateOptionsSchema,
  calcomDeleteOptionsSchema,
  calcomUpdateOptionsSchema,
} from './calcom-options';
import { bookingZone, fromBooking, isActive } from './convert-booking';
import {
  decodeListToken,
  decodeSyncState,
  encodeToken,
  type ListToken,
  type SyncState,
} from './tokens';

export type CalcomSettings = {
  /**
   * A Cal.com API key (`cal_live_...`) or OAuth access token, or a function returning a
   * fresh one per request.
   */
  accessToken: AccessToken;
  /** Defaults to `https://api.cal.com/v2`. Use `https://api.cal.eu/v2` for Cal.com EU. */
  baseURL?: string;
  /** Headers sent with every request. */
  headers?: Record<string, string | undefined>;
  /** Custom fetch, for example to add logging or to record requests in tests. */
  fetch?: FetchFunction;
};

export type CalcomProvider = CalendarProviderV1<'calcom', CalcomProviderTypes> &
  Required<Pick<CalendarProviderV1, 'doSyncEvents'>>;

const PROVIDER = 'calcom';
const MAX_PAGE_SIZE = 100;
// Bookings are found by their start, so a listing reads back from `timeMin` by the longest
// length a booking in the calendar can have, and at least a day.
const DAY_MS = 86_400_000;
// A booking saved in a slow transaction can appear after later ones. Each sync rereads this
// long before the newest change it saw, and skips bookings it already reported.
const SYNC_OVERLAP_MS = 60_000;

/**
 * Creates a Cal.com provider. Bookings are the events: `'primary'` holds every booking of
 * the user, and each event type is a calendar holding its own bookings.
 *
 * @example
 * import { calcom } from '@calsdk/calcom';
 * const calendar = calcom({ accessToken: process.env.CALCOM_API_KEY });
 */
export function calcom(settings: CalcomSettings): CalcomProvider {
  const api = createJsonFetcher({
    baseURL: settings.baseURL ?? 'https://api.cal.com/v2',
    accessToken: settings.accessToken,
    headers: settings.headers,
    fetch: settings.fetch,
  });

  type Call = Pick<CallOptionsV1, 'headers' | 'abortSignal'>;

  async function request<Output>(
    call: Call,
    resource: { type: 'calendar' | 'event'; id: string } | undefined,
    options: {
      method: 'GET' | 'POST';
      path: string;
      version?: string;
      query?: Record<string, QueryValue>;
      body?: unknown;
      schema?: z.ZodType<Output>;
    },
  ): Promise<Output> {
    const { version, ...rest } = options;
    try {
      const { value } = await api({
        ...rest,
        headers: { ...call.headers, 'cal-api-version': version },
        abortSignal: call.abortSignal,
      });
      return value;
    } catch (error) {
      throw mapAPICallError(error, { provider: PROVIDER, resource });
    }
  }

  async function getEventType(call: Call, eventTypeId: number): Promise<EventType> {
    const id = String(eventTypeId);
    const { data } = await request(
      call,
      { type: 'calendar', id },
      {
        method: 'GET',
        path: urlPath`/event-types/${id}`,
        version: API_VERSIONS.eventTypes,
        schema: eventTypeOutputSchema,
      },
    );
    return data;
  }

  /** An active booking in the calendar. Cancelled ones are deleted events. */
  async function getBooking(call: Call, calendarId: string, eventId: string): Promise<Booking> {
    const eventTypeId = eventTypeOf(calendarId);
    const { data } = await request(
      call,
      { type: 'event', id: eventId },
      {
        method: 'GET',
        path: urlPath`/bookings/${eventId}`,
        version: API_VERSIONS.bookings,
        schema: bookingOutputSchema,
      },
    );
    if (
      Array.isArray(data) ||
      !isActive(data) ||
      (eventTypeId !== undefined && data.eventTypeId !== eventTypeId)
    ) {
      throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
    }
    return data;
  }

  async function listBookings(call: Call, calendarId: string, query: Record<string, QueryValue>) {
    return request(
      call,
      { type: 'calendar', id: calendarId },
      {
        method: 'GET',
        path: '/bookings',
        version: API_VERSIONS.listBookings,
        query: { eventTypeId: eventTypeOf(calendarId), ...query },
        schema: bookingListSchema,
      },
    );
  }

  /** Every booking last changed at `changedAt`, through Cal.com's cursor. */
  async function listChangedAt(call: Call, calendarId: string, changedAt: string) {
    const bookings: Booking[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await listBookings(call, calendarId, {
        afterUpdatedAt: changedAt,
        beforeUpdatedAt: changedAt,
        limit: MAX_PAGE_SIZE,
        cursor,
      });
      bookings.push(...page.data);
      cursor = page.pagination?.hasMore ? (page.pagination.nextCursor ?? undefined) : undefined;
      if (cursor !== undefined) {
        // A cursor returned twice would loop forever.
        if (seen.has(cursor)) {
          throw new InvalidResponseDataError({
            data: cursor,
            message: 'Cal.com returned the same cursor twice.',
          });
        }
        seen.add(cursor);
      }
    } while (cursor !== undefined);
    return bookings;
  }

  async function listEventTypes(call: Call) {
    const { data } = await request(call, undefined, {
      method: 'GET',
      path: '/event-types',
      version: API_VERSIONS.eventTypes,
      schema: eventTypeListSchema,
    });
    return data;
  }

  /** The longest a booking in the calendar can last, in ms: what its event types offer. */
  async function longestBooking(call: Call, calendarId: string) {
    const eventTypeId = eventTypeOf(calendarId);
    const eventTypes =
      eventTypeId === undefined
        ? await listEventTypes(call)
        : [await getEventType(call, eventTypeId)];
    const minutes = eventTypes.flatMap((eventType) => [
      eventType.lengthInMinutes,
      ...(eventType.lengthInMinutesOptions ?? []),
    ]);
    return Math.max(...minutes, 0) * 60_000;
  }

  async function getMe(call: Call) {
    const { data } = await request(call, undefined, {
      method: 'GET',
      path: '/me',
      schema: meOutputSchema,
    });
    return data;
  }

  return {
    specificationVersion: 'v1',
    provider: PROVIDER,
    capabilities: {
      events: {
        details: false,
        allDay: false,
        recurrence: false,
        recurrenceScopeThisAndFollowing: false,
        serverSideExpansion: false,
        attendees: true,
        conference: false,
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
      const [me, eventTypes] = await Promise.all([getMe(call), listEventTypes(call)]);
      const timeZone = me.timeZone && isValidTimeZone(me.timeZone) ? me.timeZone : undefined;
      return {
        calendars: [
          { id: 'primary', name: 'All bookings', timeZone, isPrimary: true, accessRole: 'owner' },
          ...eventTypes.map((eventType) => ({
            id: String(eventType.id),
            name: eventType.title,
            timeZone,
            isPrimary: false,
            accessRole: 'owner' as const,
          })),
        ],
        warnings: [],
      };
    },

    async doGetEvent({ calendarId, eventId, ...call }) {
      const booking = await getBooking(call, calendarId, eventId);
      return { event: fromBooking(booking, { calendarId }), warnings: [] };
    },

    async doListEvents({ calendarId, timeMin, timeMax, query, pageSize, pageToken, ...call }) {
      if (query !== undefined) {
        throw new UnsupportedFunctionalityError({
          provider: PROVIDER,
          functionality: 'event search',
          message: 'Cal.com cannot search bookings. Filter the listed events instead.',
        });
      }
      const min = Date.parse(timeMin);
      const max = Date.parse(timeMax);
      const limit = Math.min(pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
      const lookback = Math.max(DAY_MS, await longestBooking(call, calendarId));
      const token: ListToken =
        pageToken === undefined
          ? { start: new Date(min - lookback).toISOString(), seen: [] }
          : decodeListToken(pageToken);
      if (token.seen.length >= MAX_PAGE_SIZE) {
        throw new InvalidResponseDataError({
          data: token.start,
          message: `${MAX_PAGE_SIZE} or more bookings start at ${token.start}, so calsdk cannot page past them.`,
        });
      }

      // Bookings already returned at the token's start come back first, so the request
      // asks for that many more, up to Cal.com's limit.
      const fetched = Math.min(MAX_PAGE_SIZE, token.seen.length + limit);
      const { data: bookings } = await listBookings(call, calendarId, {
        afterStart: token.start,
        sortStart: 'asc',
        limit: fetched,
      });
      const events = [];
      let { start, seen } = token;
      let more = bookings.length === fetched;
      for (const [index, booking] of bookings.entries()) {
        if (Date.parse(booking.start) >= max) {
          more = false;
          break;
        }
        if (Date.parse(booking.start) !== Date.parse(start)) {
          start = booking.start;
          seen = [];
        } else if (seen.includes(booking.uid)) {
          continue;
        }
        seen = [...seen, booking.uid];
        if (isActive(booking) && Date.parse(booking.end) > min) {
          events.push(fromBooking(booking, { calendarId }));
        }
        if (events.length === limit) {
          more ||= index < bookings.length - 1;
          break;
        }
      }
      return {
        events,
        nextPageToken: more ? encodeToken({ start, seen }) : undefined,
        warnings: [],
      };
    },

    async doCreateEvent({ calendarId, event, sendUpdates, providerOptions, ...call }) {
      const { options, warnings } = await parseProviderOptions({
        provider: PROVIDER,
        providerOptions,
        schema: calcomCreateOptionsSchema,
      });
      if (event.recurrence?.length) throw unsupported('recurring events');
      if (isAllDay(event.start) || isAllDay(event.end)) throw unsupported('all-day events');
      const calendarEventType = eventTypeOf(calendarId);
      if (
        calendarEventType !== undefined &&
        options?.eventTypeId !== undefined &&
        options.eventTypeId !== calendarEventType
      ) {
        throw new InvalidArgumentError({
          argument: 'providerOptions.calcom.eventTypeId',
          message: 'It must match the calendar id. Omit it when booking on an event type calendar.',
        });
      }
      const eventTypeId = calendarEventType ?? options?.eventTypeId;
      if (eventTypeId === undefined) {
        throw new InvalidArgumentError({
          argument: 'providerOptions.calcom.eventTypeId',
          message:
            'Bookings on the primary calendar need an event type. Pass providerOptions.calcom.eventTypeId, or use the event type id as the calendar id.',
        });
      }
      warnIgnored(event, CREATE_IGNORED, warnings);
      warnSendUpdates(sendUpdates, warnings);

      const eventType = await getEventType(call, eventTypeId);
      if (eventType.recurrence) throw unsupported('booking recurring event types');
      const start = eventTimeToInstant(event.start);
      const lengthInMinutes = bookingLength(
        eventType,
        eventTimeToInstant(event.end) - start,
        'event.end',
      );
      // The first attendee books the slot. Without one, the user books it for themselves.
      const [first, ...guests] = event.attendees ?? [];
      const attendee = first ?? (await getMe(call));
      const { data } = await request(
        call,
        { type: 'calendar', id: calendarId },
        {
          method: 'POST',
          path: '/bookings',
          version: API_VERSIONS.bookings,
          body: {
            eventTypeId,
            start: new Date(start).toISOString(),
            attendee: {
              name: attendee.name || attendee.email,
              email: attendee.email,
              timeZone: event.start.timeZone,
            },
            guests: guests.length > 0 ? guests.map((guest) => guest.email) : undefined,
            lengthInMinutes,
            bookingFieldsResponses: event.description ? { notes: event.description } : undefined,
            metadata: options?.metadata,
            allowConflicts: options?.allowConflicts ?? true,
            allowBookingOutOfBounds: options?.allowBookingOutOfBounds ?? true,
          },
          schema: bookingOutputSchema,
        },
      );
      return { event: fromBooking(single(data), { calendarId }), warnings };
    },

    async doUpdateEvent({
      calendarId,
      eventId,
      patch,
      ifMatch,
      sendUpdates,
      providerOptions,
      ...call
    }) {
      const { options, warnings } = await parseProviderOptions({
        provider: PROVIDER,
        providerOptions,
        schema: calcomUpdateOptionsSchema,
      });
      if (ifMatch !== undefined) throw unsupported('conditional updates');
      if (patch.recurrence?.length) throw unsupported('recurring events');
      if ((patch.start && isAllDay(patch.start)) || (patch.end && isAllDay(patch.end))) {
        throw unsupported('all-day events');
      }
      warnIgnored(patch, UPDATE_IGNORED, warnings);
      warnSendUpdates(sendUpdates, warnings);

      const current = await getBooking(call, calendarId, eventId);
      const from = Date.parse(current.start);
      const start = patch.start ? eventTimeToInstant(patch.start) : from;
      const end = patch.end
        ? eventTimeToInstant(patch.end)
        : start + Date.parse(current.end) - from;
      if (start === from && end === Date.parse(current.end)) {
        return { event: fromBooking(current, { calendarId }), warnings };
      }
      if (current.eventTypeId == null) throw unsupported('moving bookings without an event type');
      const eventType = await getEventType(call, current.eventTypeId);
      const lengthInMinutes = bookingLength(eventType, end - start, 'patch.end');
      const zone = bookingZone(current);
      if (patch.start && canonicalZone(patch.start.timeZone) !== canonicalZone(zone)) {
        warnings.push({
          type: 'unsupported',
          feature: 'timeZone',
          details: `Cal.com keeps the time zone the booking was made in, ${zone}.`,
        });
      }

      // Cal.com moves a booking by replacing it: the old uid is cancelled.
      const { data } = await request(
        call,
        { type: 'event', id: eventId },
        {
          method: 'POST',
          path: urlPath`/bookings/${eventId}/reschedule`,
          version: API_VERSIONS.bookings,
          body: {
            start: new Date(start).toISOString(),
            lengthInMinutes,
            reschedulingReason: options?.reschedulingReason,
            allowConflicts: options?.allowConflicts ?? true,
            allowBookingOutOfBounds: options?.allowBookingOutOfBounds ?? true,
          },
          schema: bookingOutputSchema,
        },
      );
      return { event: fromBooking(single(data), { calendarId }), warnings };
    },

    async doDeleteEvent({ calendarId, eventId, ifMatch, sendUpdates, providerOptions, ...call }) {
      const { options, warnings } = await parseProviderOptions({
        provider: PROVIDER,
        providerOptions,
        schema: calcomDeleteOptionsSchema,
      });
      if (ifMatch !== undefined) throw unsupported('conditional deletes');
      warnSendUpdates(sendUpdates, warnings);
      // Cancelling a cancelled booking fails, and it must read as a missing event.
      await getBooking(call, calendarId, eventId);
      await request(
        call,
        { type: 'event', id: eventId },
        {
          method: 'POST',
          path: urlPath`/bookings/${eventId}/cancel`,
          version: API_VERSIONS.bookings,
          body: { cancellationReason: options?.cancellationReason ?? 'Cancelled' },
        },
      );
      return { warnings };
    },

    async doSyncEvents({ calendarId, cursor, pageToken, ...call }) {
      eventTypeOf(calendarId);
      const state: SyncState =
        pageToken !== undefined
          ? decodeSyncState(pageToken, 'pageToken')
          : cursor !== undefined
            ? decodeSyncState(cursor, 'cursor')
            : { calendarId, seen: {}, initial: true };
      if (state.calendarId !== calendarId) {
        throw new InvalidArgumentError({
          argument: pageToken !== undefined ? 'pageToken' : 'cursor',
          message: `It belongs to calendar "${state.calendarId}", not "${calendarId}".`,
        });
      }

      const page = await listBookings(call, calendarId, {
        afterUpdatedAt: state.after,
        sortUpdatedAt: 'asc',
        limit: MAX_PAGE_SIZE,
      });
      const full = page.data.length === MAX_PAGE_SIZE;
      const first = page.data[0];
      const last = page.data.at(-1);
      // A full page changed at one time can hide more bookings changed then, and the next
      // page would start at that time again. Cal.com's cursor reads all of them instead.
      const tied =
        full && first && last && changeTime(first) === changeTime(last)
          ? changeTime(last)
          : undefined;
      const bookings = tied === undefined ? page.data : await listChangedAt(call, calendarId, tied);
      const seen = { ...state.seen };
      const changes: SyncChangeV1[] = [];
      for (const booking of bookings) {
        const changedAt = changeTime(booking);
        if (seen[booking.uid] === changedAt) continue;
        seen[booking.uid] = changedAt;
        if (isActive(booking)) {
          changes.push({ type: 'upsert', event: fromBooking(booking, { calendarId }) });
        } else if (!state.initial) {
          // An initial sync has nothing to delete yet.
          changes.push({ type: 'delete', eventId: booking.uid });
        }
      }

      const newest = Math.max(...Object.values(seen).map(Date.parse));
      // Bookings changed within the overlap are reread, so they stay in `seen`.
      const recent = (after: number) =>
        Object.fromEntries(
          Object.entries(seen).filter(([, changedAt]) => Date.parse(changedAt) >= after),
        );
      if (full && last) {
        // After a tie, every booking changed at that time has been read.
        const after =
          tied === undefined ? changeTime(last) : new Date(Date.parse(tied) + 1).toISOString();
        return {
          changes,
          nextPageToken: encodeToken({
            calendarId,
            after,
            seen: recent(newest - SYNC_OVERLAP_MS),
            initial: state.initial,
          }),
          warnings: [],
        };
      }
      const after = Number.isFinite(newest)
        ? new Date(newest - SYNC_OVERLAP_MS).toISOString()
        : state.after;
      return {
        changes,
        nextCursor: encodeToken({
          calendarId,
          after,
          seen: after === undefined ? {} : recent(Date.parse(after)),
          initial: false,
        }),
        warnings: [],
      };
    },
  };
}

/** The event type a calendar id names, or `undefined` for `'primary'`, which holds every booking. */
function eventTypeOf(calendarId: string): number | undefined {
  if (calendarId === 'primary') return undefined;
  if (/^[1-9]\d{0,14}$/.test(calendarId)) return Number(calendarId);
  throw new NotFoundError({ provider: PROVIDER, resource: 'calendar', id: calendarId });
}

/** When a booking last changed. Cal.com sets `updatedAt` on every booking it saves. */
function changeTime(booking: Booking): string {
  return booking.updatedAt ?? booking.createdAt ?? booking.start;
}

/** The booking a create or reschedule returned. Recurring event types return several. */
function single(data: Booking | unknown[]): Booking {
  if (Array.isArray(data)) {
    throw new InvalidResponseDataError({
      data,
      message: 'Cal.com returned a recurring booking. calsdk only books single slots.',
    });
  }
  return data;
}

/**
 * `lengthInMinutes` for a booking lasting `ms`, or `undefined` for the event type's own
 * length. Cal.com only books the lengths an event type offers.
 */
function bookingLength(eventType: EventType, ms: number, argument: string): number | undefined {
  const minutes = ms / 60_000;
  if (minutes === eventType.lengthInMinutes) return undefined;
  const options = eventType.lengthInMinutesOptions ?? [];
  if (options.includes(minutes)) return minutes;
  const lengths = [...new Set([eventType.lengthInMinutes, ...options])].sort((a, b) => a - b);
  throw new InvalidArgumentError({
    argument,
    message: `Event type ${eventType.id} books ${lengths.join(', ')} minute slots, not ${minutes} minutes.`,
  });
}

function unsupported(functionality: string) {
  return new UnsupportedFunctionalityError({ provider: PROVIDER, functionality });
}

// Fields a booking takes from its event type, or cannot change once made.
const CREATE_IGNORED: [keyof EventPatchV1, string][] = [
  ['title', 'Cal.com names bookings after their event type.'],
  ['location', 'Cal.com takes the location from the event type.'],
  ['visibility', 'Cal.com bookings have no visibility setting.'],
  ['createConference', 'Cal.com adds the meeting link the event type is set up with.'],
  ['reminders', 'Cal.com sends the reminders its workflows set up.'],
  ['color', 'Cal.com bookings have no color.'],
];
const UPDATE_IGNORED: [keyof EventPatchV1, string][] = [
  ...CREATE_IGNORED,
  ['description', 'Cal.com cannot change the notes of a booking.'],
  ['attendees', 'Cal.com cannot change the attendees of a booking.'],
];

function warnIgnored(
  fields: EventPatchV1,
  ignored: [keyof EventPatchV1, string][],
  warnings: WarningV1[],
) {
  for (const [feature, details] of ignored) {
    if (fields[feature] !== undefined) warnings.push({ type: 'unsupported', feature, details });
  }
  if (fields.showAs === 'free') {
    warnings.push({
      type: 'unsupported',
      feature: 'showAs',
      details: 'Cal.com bookings always block time.',
    });
  }
  if (fields.attendees?.some((attendee) => attendee.optional)) {
    warnings.push({
      type: 'unsupported',
      feature: 'attendees.optional',
      details: 'Cal.com has no optional attendees.',
    });
  }
}

function warnSendUpdates(sendUpdates: SendUpdatesV1 | undefined, warnings: WarningV1[]) {
  if (sendUpdates !== undefined && sendUpdates !== 'all') {
    warnings.push({
      type: 'unsupported',
      feature: 'sendUpdates',
      details: 'Cal.com always emails attendees about their bookings.',
    });
  }
}

function canonicalZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
}
