import {
  APICallError,
  type CalendarProviderV1,
  type CallOptionsV1,
  type EventInputV1,
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
  eventTypeOutputSchema,
  inviteeListSchema,
  inviteeOutputSchema,
  type ScheduledEvent,
  scheduledEventListSchema,
  scheduledEventOutputSchema,
  type User,
  userOutputSchema,
} from './calendly-api';
import {
  type CalendlyProviderTypes,
  calendlyCreateOptionsSchema,
  calendlyDeleteOptionsSchema,
} from './calendly-options';
import { fromScheduledEvent, uuidOf } from './convert-event';
import { decodeSyncCursor, encodeSyncCursor, hashOf } from './tokens';

export type CalendlySettings = {
  /**
   * A Calendly personal access token or OAuth access token, or a function returning a fresh
   * one per request.
   */
  accessToken: AccessToken;
  /** Headers sent with every request. */
  headers?: Record<string, string | undefined>;
  /** Custom fetch, for example to add logging or to record requests in tests. */
  fetch?: FetchFunction;
};

export type CalendlyProvider = CalendarProviderV1<'calendly', CalendlyProviderTypes> &
  Required<Pick<CalendarProviderV1, 'doSyncEvents'>>;

const PROVIDER = 'calendly';
const BASE_URL = 'https://api.calendly.com';
const MAX_PAGE_SIZE = 100;
// Meetings are found by their start, and Calendly meetings last at most 12 hours, so a
// listing reads back a day from `timeMin` for meetings that started before it.
const LOOKBACK_MS = 86_400_000;

type Call = Pick<CallOptionsV1, 'headers' | 'abortSignal'>;
type Resource = { type: 'calendar' | 'event'; id: string };
type Page<Item> = { collection: Item[]; pagination: { next_page_token?: string | null } };

/**
 * Creates a Calendly provider. Scheduled meetings are the events, all in the `'primary'`
 * calendar.
 *
 * @example
 * import { calendly } from '@calsdk/calendly';
 * const calendar = calendly({ accessToken: process.env.CALENDLY_TOKEN });
 */
export function calendly(settings: CalendlySettings): CalendlyProvider {
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
      method: 'GET' | 'POST';
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
      throw mapAPICallError(error, { provider: PROVIDER, resource });
    }
  }

  /** Every item of a Calendly collection, page by page. */
  async function readAll<Item>(
    call: Call,
    resource: Resource,
    path: string,
    query: Record<string, QueryValue>,
    schema: z.ZodType<Page<Item>>,
  ): Promise<Item[]> {
    const items: Item[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    do {
      const page = await request(call, resource, {
        method: 'GET',
        path,
        query: { ...query, count: MAX_PAGE_SIZE, page_token: pageToken },
        schema,
      });
      items.push(...page.collection);
      pageToken = page.pagination.next_page_token ?? undefined;
      if (pageToken !== undefined) {
        // A page token returned twice would loop forever.
        if (seen.has(pageToken)) {
          throw new InvalidResponseDataError({
            data: pageToken,
            message: 'Calendly returned the same page token twice.',
          });
        }
        seen.add(pageToken);
      }
    } while (pageToken !== undefined);
    return items;
  }

  async function getMe(call: Call): Promise<User> {
    const { resource } = await request(call, undefined, {
      method: 'GET',
      path: '/users/me',
      schema: userOutputSchema,
    });
    return resource;
  }

  /** An active meeting. Cancelled ones are deleted events. */
  async function getScheduledEvent(call: Call, eventId: string): Promise<ScheduledEvent> {
    const { resource } = await request(
      call,
      { type: 'event', id: eventId },
      {
        method: 'GET',
        path: urlPath`/scheduled_events/${eventId}`,
        schema: scheduledEventOutputSchema,
      },
    );
    if (resource.status !== 'active') {
      throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
    }
    return resource;
  }

  const listInvitees = (call: Call, eventId: string) =>
    readAll(
      call,
      { type: 'event', id: eventId },
      urlPath`/scheduled_events/${eventId}/invitees`,
      {},
      inviteeListSchema,
    );

  async function getEvent(call: Call, eventId: string, me: User) {
    const [scheduled, invitees] = await Promise.all([
      getScheduledEvent(call, eventId),
      listInvitees(call, eventId),
    ]);
    return fromScheduledEvent(scheduled, { timeZone: zoneOf(me), invitees });
  }

  async function getEventType(call: Call, eventType: string) {
    const prefix = `${BASE_URL}/event_types/`;
    const uuid = eventType.startsWith(prefix) ? eventType.slice(prefix.length) : eventType;
    try {
      const { resource } = await request(call, undefined, {
        method: 'GET',
        path: urlPath`/event_types/${uuid}`,
        schema: eventTypeOutputSchema,
      });
      return resource;
    } catch (error) {
      if (APICallError.isInstance(error) && error.statusCode === 404) {
        throw new InvalidArgumentError({
          argument: 'providerOptions.calendly.eventType',
          message: `Calendly has no event type "${eventType}".`,
          cause: error,
        });
      }
      throw error;
    }
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
      const me = await getMe(call);
      return {
        calendars: [
          {
            id: 'primary',
            name: 'Scheduled events',
            timeZone: zoneOf(me),
            isPrimary: true,
            accessRole: 'owner',
          },
        ],
        warnings: [],
      };
    },

    async doGetEvent({ calendarId, eventId, ...call }) {
      assertPrimary(calendarId);
      const me = await getMe(call);
      return { event: await getEvent(call, eventId, me), warnings: [] };
    },

    async doListEvents({ calendarId, timeMin, timeMax, query, pageSize, pageToken, ...call }) {
      if (query !== undefined) {
        throw new UnsupportedFunctionalityError({
          provider: PROVIDER,
          functionality: 'event search',
          message: 'Calendly cannot search meetings. Filter the listed events instead.',
        });
      }
      assertPrimary(calendarId);
      const min = Date.parse(timeMin);
      const max = Date.parse(timeMax);
      const me = await getMe(call);
      const page = await request(
        call,
        { type: 'calendar', id: calendarId },
        {
          method: 'GET',
          path: '/scheduled_events',
          query: {
            user: me.uri,
            status: 'active',
            sort: 'start_time:asc',
            min_start_time: new Date(min - LOOKBACK_MS).toISOString(),
            max_start_time: new Date(max).toISOString(),
            count: Math.min(pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE),
            page_token: pageToken,
          },
          schema: scheduledEventListSchema,
        },
      );
      const timeZone = zoneOf(me);
      return {
        events: page.collection
          .filter(
            (event) =>
              event.status === 'active' &&
              Date.parse(event.end_time) > min &&
              Date.parse(event.start_time) < max,
          )
          .map((event) => fromScheduledEvent(event, { timeZone })),
        nextPageToken: page.pagination.next_page_token ?? undefined,
        warnings: [],
      };
    },

    async doCreateEvent({ calendarId, event, sendUpdates, providerOptions, ...call }) {
      const { options, warnings } = await parseProviderOptions({
        provider: PROVIDER,
        providerOptions,
        schema: calendlyCreateOptionsSchema,
      });
      assertPrimary(calendarId);
      if (!options) {
        throw new InvalidArgumentError({
          argument: 'providerOptions.calendly.eventType',
          message: 'Calendly books meetings on an event type. Pass its URI or uuid.',
        });
      }
      if (event.recurrence?.length) throw unsupported('recurring events');
      if (isAllDay(event.start) || isAllDay(event.end)) throw unsupported('all-day events');
      warnIgnored(event, warnings);
      warnSendUpdates(sendUpdates, warnings);

      const [me, eventType] = await Promise.all([
        getMe(call),
        getEventType(call, options.eventType),
      ]);
      const start = eventTimeToInstant(event.start);
      const minutes = (eventTimeToInstant(event.end) - start) / 60_000;
      // Calendly books the length the event type sets, and takes no other.
      if (minutes !== eventType.duration) {
        throw new InvalidArgumentError({
          argument: 'event.end',
          message: `The event type books ${eventType.duration} minute meetings, not ${minutes} minutes.`,
        });
      }
      // The first attendee books the meeting. Without one, the user books it for themselves.
      const [first, ...guests] = event.attendees ?? [];
      const invitee = first ?? me;
      const { resource } = await request(
        call,
        { type: 'calendar', id: calendarId },
        {
          method: 'POST',
          path: '/invitees',
          body: {
            event_type: eventType.uri,
            start_time: new Date(start).toISOString(),
            invitee: {
              name: invitee.name || invitee.email,
              email: invitee.email,
              timezone: event.start.timeZone,
            },
            event_guests: guests.length > 0 ? guests.map((guest) => guest.email) : undefined,
            location: options.location,
          },
          schema: inviteeOutputSchema,
        },
      );
      return { event: await getEvent(call, uuidOf(resource.event), me), warnings };
    },

    async doUpdateEvent() {
      throw new UnsupportedFunctionalityError({
        provider: PROVIDER,
        functionality: 'updating events',
        message: 'Calendly cannot change a scheduled meeting. Delete it and create a new one.',
      });
    },

    async doDeleteEvent({ calendarId, eventId, ifMatch, sendUpdates, providerOptions, ...call }) {
      const { options, warnings } = await parseProviderOptions({
        provider: PROVIDER,
        providerOptions,
        schema: calendlyDeleteOptionsSchema,
      });
      assertPrimary(calendarId);
      if (ifMatch !== undefined) throw unsupported('conditional deletes');
      warnSendUpdates(sendUpdates, warnings);
      // Cancelling a cancelled meeting fails, and it must read as a missing event.
      await getScheduledEvent(call, eventId);
      await request(
        call,
        { type: 'event', id: eventId },
        {
          method: 'POST',
          path: urlPath`/scheduled_events/${eventId}/cancellation`,
          body: { reason: options?.reason },
        },
      );
      return { warnings };
    },

    async doSyncEvents({ calendarId, cursor, pageToken, ...call }) {
      assertPrimary(calendarId);
      if (pageToken !== undefined) {
        throw new InvalidArgumentError({
          argument: 'pageToken',
          message: 'The Calendly provider returns every change on one page.',
        });
      }
      const previous = cursor === undefined ? undefined : new Map(decodeSyncCursor(cursor).events);
      const me = await getMe(call);
      const scheduled = await readAll(
        call,
        { type: 'calendar', id: calendarId },
        '/scheduled_events',
        { user: me.uri, status: 'active', sort: 'start_time:asc' },
        scheduledEventListSchema,
      );
      const timeZone = zoneOf(me);
      const hashes = new Map<string, string>();
      const changes: SyncChangeV1[] = [];
      for (const item of scheduled) {
        if (item.status !== 'active') continue;
        const event = fromScheduledEvent(item, { timeZone });
        if (hashes.has(event.id)) continue;
        const hash = hashOf(JSON.stringify(event));
        hashes.set(event.id, hash);
        if (previous?.get(event.id) !== hash) changes.push({ type: 'upsert', event });
      }
      // Meetings the last sync saw that are no longer active were cancelled.
      for (const eventId of previous?.keys() ?? []) {
        if (!hashes.has(eventId)) changes.push({ type: 'delete', eventId });
      }
      return {
        changes,
        nextCursor: encodeSyncCursor({ events: [...hashes] }),
        warnings: [],
      };
    },
  };
}

/** Times are shown in the user's Calendly time zone. */
function zoneOf(user: User): string {
  return user.timezone && isValidTimeZone(user.timezone) ? user.timezone : 'UTC';
}

function assertPrimary(calendarId: string) {
  if (calendarId !== 'primary') {
    throw new NotFoundError({ provider: PROVIDER, resource: 'calendar', id: calendarId });
  }
}

function unsupported(functionality: string) {
  return new UnsupportedFunctionalityError({ provider: PROVIDER, functionality });
}

// Fields a meeting takes from its event type.
const IGNORED: [keyof EventInputV1, string][] = [
  ['title', 'Calendly names meetings after their event type.'],
  ['description', 'Calendly takes notes from the questions its event type asks.'],
  [
    'location',
    'Calendly takes the location from the event type. Pick one of its locations with providerOptions.calendly.location.',
  ],
  ['visibility', 'Calendly meetings have no visibility setting.'],
  ['createConference', 'Calendly adds the meeting link the event type is set up with.'],
  ['reminders', 'Calendly sends the reminders its workflows set up.'],
  ['color', 'Calendly meetings have no color.'],
];

function warnIgnored(event: EventInputV1, warnings: WarningV1[]) {
  for (const [feature, details] of IGNORED) {
    if (event[feature] !== undefined) warnings.push({ type: 'unsupported', feature, details });
  }
  if (event.showAs === 'free') {
    warnings.push({
      type: 'unsupported',
      feature: 'showAs',
      details: 'Calendly meetings always block time.',
    });
  }
  if (event.attendees?.some((attendee) => attendee.optional)) {
    warnings.push({
      type: 'unsupported',
      feature: 'attendees.optional',
      details: 'Calendly has no optional attendees.',
    });
  }
}

function warnSendUpdates(sendUpdates: SendUpdatesV1 | undefined, warnings: WarningV1[]) {
  if (sendUpdates !== undefined && sendUpdates !== 'all') {
    warnings.push({
      type: 'unsupported',
      feature: 'sendUpdates',
      details: 'Calendly always emails invitees about their meetings.',
    });
  }
}
