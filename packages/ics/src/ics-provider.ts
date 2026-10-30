import {
  type CalendarProviderV1,
  type CallOptionsV1,
  type EventV1,
  InvalidArgumentError,
  NotFoundError,
  type SyncChangeV1,
  UnsupportedFunctionalityError,
  type WarningV1,
} from '@calsdk/provider';
import {
  combineHeaders,
  eventTimeToInstant,
  type FetchFunction,
  isValidTimeZone,
  mapAPICallError,
} from '@calsdk/provider-utils';
import {
  cancelledKeys,
  findEvent,
  instancesBetween,
  masterOf,
  storedEvents,
} from './convert-event';
import { type Feed, feedURL, fetchFeed } from './fetch-feed';
import { type ParsedICalendar, parseICalendar } from './parse-icalendar';
import { decodeListToken, decodeSyncCursor, encodeToken, hashOf, type ListToken } from './tokens';

export type IcsSettings = {
  /**
   * The feed's address. `webcal://` addresses are read over HTTPS. Private feed addresses
   * hold a secret, so errors only report their origin.
   */
  url: string;
  /**
   * Zone for times the feed gives without one, when it declares no `X-WR-TIMEZONE`.
   * Defaults to UTC.
   */
  timeZone?: string;
  /**
   * Headers sent with every request, for example `authorization` for a feed behind a
   * password. They are not sent when the feed redirects to another origin.
   */
  headers?: Record<string, string | undefined>;
  /** Custom fetch, for example to add logging or to record requests in tests. */
  fetch?: FetchFunction;
};

export type IcsProvider = CalendarProviderV1<
  'ics',
  { options: Record<never, never>; eventMetadata: never }
> &
  Required<Pick<CalendarProviderV1, 'doSyncEvents'>>;

const PROVIDER = 'ics';
const DEFAULT_PAGE_SIZE = 250;
/** Stands for an instance's hash once a cancellation deleted it. */
const CANCELLED = '-';
const READ_ONLY = { condition: 'Read only: feeds cannot be changed.' };

/**
 * Creates a read-only provider for an iCalendar feed (a `.ics` subscription URL), such as a
 * holiday calendar or a calendar shared by its secret address. The feed is the
 * `'primary'` calendar. Every call downloads it again.
 *
 * Event ids are the feed's `UID`s. Instances of a series are `<UID>_<original start>`, the
 * start being a UTC date-time (`20261103T100000Z`) or, for all-day series, a date.
 *
 * @example
 * import { ics } from '@calsdk/ics';
 * const holidays = ics({ url: 'webcal://example.com/holidays.ics' });
 */
export function ics(settings: IcsSettings): IcsProvider {
  const url = feedURL(settings.url);
  if (settings.timeZone !== undefined && !isValidTimeZone(settings.timeZone)) {
    throw new InvalidArgumentError({
      argument: 'timeZone',
      message: `"${settings.timeZone}" is not an IANA time zone.`,
    });
  }

  type Call = Pick<CallOptionsV1, 'headers' | 'abortSignal'>;

  async function download(
    call: Call,
    calendarId: string,
    conditional?: { ifNoneMatch?: string; ifModifiedSince?: string },
  ): Promise<{ feed: Feed; calendar: ParsedICalendar } | 'not-modified'> {
    if (calendarId !== 'primary') {
      throw new NotFoundError({ provider: PROVIDER, resource: 'calendar', id: calendarId });
    }
    let feed: Feed | 'not-modified';
    try {
      feed = await fetchFeed({
        url,
        headers: combineHeaders(settings.headers, call.headers),
        fetch: settings.fetch,
        abortSignal: call.abortSignal,
        ...conditional,
      });
    } catch (error) {
      throw mapAPICallError(error, {
        provider: PROVIDER,
        resource: { type: 'calendar', id: calendarId },
      });
    }
    if (feed === 'not-modified') return feed;
    const calendar = parseICalendar(feed.text, { calendarId, defaultTimeZone: settings.timeZone });
    return { feed, calendar };
  }

  async function load(call: Call, calendarId: string): Promise<ParsedICalendar> {
    const result = await download(call, calendarId);
    if (result === 'not-modified') throw new Error('Unreachable: the request was not conditional.');
    return result.calendar;
  }

  const readOnly = () =>
    new UnsupportedFunctionalityError({
      provider: PROVIDER,
      functionality: 'changing events: ICS feeds are read-only',
    });

  return {
    specificationVersion: 'v1',
    provider: PROVIDER,
    capabilities: {
      events: {
        details: false,
        allDay: READ_ONLY,
        recurrence: READ_ONLY,
        recurrenceScopeThisAndFollowing: false,
        serverSideExpansion: true,
        attendees: READ_ONLY,
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
      const calendar = await load(call, 'primary');
      return {
        calendars: [
          {
            id: 'primary',
            name: calendar.name ?? url.hostname,
            description: calendar.description,
            timeZone: calendar.timeZone ?? settings.timeZone,
            isPrimary: true,
            accessRole: 'reader',
          },
        ],
        warnings: [],
      };
    },

    async doGetEvent({ calendarId, eventId, ...call }) {
      const calendar = await load(call, calendarId);
      const warnings: WarningV1[] = [];
      const event = findEvent(calendar.groups, eventId, calendar.context, warnings);
      if (!event) throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
      return { event, warnings };
    },

    async doListEvents({
      calendarId,
      timeMin,
      timeMax,
      expandRecurring,
      query,
      pageSize = DEFAULT_PAGE_SIZE,
      pageToken,
      ...call
    }) {
      if (query !== undefined) {
        throw new UnsupportedFunctionalityError({ provider: PROVIDER, functionality: 'search' });
      }
      const after = pageToken ? decodeListToken(pageToken) : undefined;
      const calendar = await load(call, calendarId);
      const { context } = calendar;
      const min = Date.parse(timeMin);
      const max = Date.parse(timeMax);
      const warnings: WarningV1[] = [];

      const events: { start: number; event: EventV1 }[] = [];
      for (const group of calendar.groups.values()) {
        const instances = instancesBetween(group, context, min, max, warnings);
        const master = masterOf(group, context);
        // Unexpanded listings return series that have an instance in the window.
        const matches =
          expandRecurring || !master ? instances : instances.length > 0 ? [master] : [];
        for (const event of matches) {
          events.push({ start: eventTimeToInstant(event.start, context.timeZone), event });
        }
      }
      events.sort((a, b) => a.start - b.start || compare(a.event.id, b.event.id));

      const remaining = after ? events.filter((item) => isAfter(item, after)) : events;
      const page = remaining.slice(0, pageSize);
      const last = page.at(-1);
      return {
        events: page.map((item) => item.event),
        nextPageToken:
          remaining.length > page.length && last
            ? encodeToken({ start: last.start, id: last.event.id })
            : undefined,
        warnings,
      };
    },

    async doCreateEvent() {
      throw readOnly();
    },
    async doUpdateEvent() {
      throw readOnly();
    },
    async doDeleteEvent() {
      throw readOnly();
    },

    /**
     * Downloads the feed and reports what changed since the cursor: single events, series
     * and their exceptions, never computed occurrences. A feed that answers a conditional
     * request with 304 Not Modified is not parsed again.
     */
    async doSyncEvents({ calendarId, cursor, pageToken, ...call }) {
      if (pageToken !== undefined) {
        throw new InvalidArgumentError({
          argument: 'pageToken',
          message: 'The ICS provider returns every change on one page.',
        });
      }
      const previous = cursor ? decodeSyncCursor(cursor) : undefined;
      const result = await download(
        call,
        calendarId,
        previous && { ifNoneMatch: previous.etag, ifModifiedSince: previous.lastModified },
      );
      if (result === 'not-modified') return { changes: [], nextCursor: cursor, warnings: [] };

      const { feed, calendar } = result;
      const seen = new Map(previous?.events);
      const hashes = new Map<string, string>();
      const changes: SyncChangeV1[] = [];
      for (const group of calendar.groups.values()) {
        const cancelled = cancelledKeys(group, calendar.context);
        for (const event of storedEvents(group, calendar.context)) {
          if (hashes.has(event.id)) continue;
          // A series changes when it cancels an instance or stops cancelling one.
          const hash = hashOf(
            JSON.stringify(event.kind === 'exception' ? event : [event, cancelled]),
          );
          hashes.set(event.id, hash);
          if (seen.get(event.id) !== hash) changes.push({ type: 'upsert', event });
        }
        // A cancelled instance is deleted once, when the cancellation first appears.
        for (const key of cancelled) {
          const eventId = `${group.uid}_${key}`;
          if (hashes.has(eventId)) continue;
          hashes.set(eventId, CANCELLED);
          if (previous && seen.get(eventId) !== CANCELLED)
            changes.push({ type: 'delete', eventId });
        }
      }
      for (const [eventId, hash] of seen) {
        if (!hashes.has(eventId) && hash !== CANCELLED) changes.push({ type: 'delete', eventId });
      }
      return {
        changes,
        nextCursor: encodeToken({
          etag: feed.etag,
          lastModified: feed.lastModified,
          events: [...hashes],
        }),
        warnings: [],
      };
    },
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const isAfter = (item: { start: number; event: EventV1 }, token: ListToken) =>
  item.start > token.start || (item.start === token.start && compare(item.event.id, token.id) > 0);
