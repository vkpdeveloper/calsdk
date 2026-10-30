import {
  cancelledKeys,
  type EventGroup,
  findEvent,
  instancesBetween,
  masterOf,
  type ParsedICalendar,
  parseICalendar,
  type ReadContext,
  recurrenceKey,
  storedEvents,
} from '@calsdk/ics/icalendar';
import {
  APICallError,
  type CalendarProviderV1,
  type EventTimeV1,
  type EventV1,
  InvalidArgumentError,
  NotFoundError,
  type SyncChangeV1,
  SyncCursorExpiredError,
  UnsupportedFunctionalityError,
  type WarningV1,
} from '@calsdk/provider';
import {
  addDaysToDate,
  eventTimeToInstant,
  type FetchFunction,
  formatICalDate,
  formatZonedDateTime,
  instantToICalDate,
  isAllDay,
  isValidTimeZone,
  mapAPICallError,
} from '@calsdk/provider-utils';
import { type Call, createDavClient } from './dav-client';
import { type Discovery, discover, listDavCalendars, withSlash } from './discover';
import { CALDAV, DAV, parseMultistatus, propText, xml } from './multistatus';
import {
  decodeListToken,
  decodeSyncCursor,
  encodeToken,
  type ListToken,
  type SyncCursor,
} from './tokens';
import {
  applyPatch,
  instanceProperty,
  newCalendar,
  newException,
  setScheduleAgent,
  setTime,
  touch,
} from './write-event';

export type CaldavSettings = {
  /**
   * The server's CalDAV address, such as `https://caldav.fastmail.com/dav/`. The provider
   * finds the account's calendars from it.
   */
  serverUrl: string;
  username: string;
  /** The password, or an app-specific password where the server asks for one. */
  password: string;
  /**
   * Zone for times stored without one, and for the bounds of all-day events in listings.
   * Defaults to UTC.
   */
  timeZone?: string;
  /** Headers sent with every request. */
  headers?: Record<string, string | undefined>;
  /** Custom fetch, for example to add logging or to record requests in tests. */
  fetch?: FetchFunction;
};

export type CaldavProvider = CalendarProviderV1<
  'caldav',
  { options: Record<never, never>; eventMetadata: never }
> &
  Required<Pick<CalendarProviderV1, 'doSyncEvents'>>;

const PROVIDER = 'caldav';
const DEFAULT_PAGE_SIZE = 250;
const DAY_MS = 86_400_000;
const MULTIGET_BATCH = 100;
const MAX_SYNC_ROUNDS = 100;
/** Marks the cursor's keys of cancelled instances, already reported as deleted. */
const CANCELLED = '-';

/** A stored `.ics` resource: one event or series with its exceptions. */
type Resource = {
  id: string;
  url: URL;
  etag?: string;
  calendar: ParsedICalendar;
  group: EventGroup;
};

/** What an event id points at: a whole resource, or one instance of the series in it. */
type Target = { resource: Resource; instance?: EventV1 };

/**
 * Creates a provider for a CalDAV server (RFC 4791), such as Fastmail, Nextcloud or
 * Radicale. Use `icloud()` for iCloud.
 *
 * Calendar ids are the paths of the calendar collections, such as `/dav/calendars/user/me/work/`.
 * Event ids are the names of the event resources without `.ics`, normally their `UID`.
 * Instances of a series are `<id>_<original start>`, the start being a UTC date-time
 * (`20261103T100000Z`) or, for all-day series, a date.
 *
 * @example
 * import { caldav } from '@calsdk/caldav';
 * const calendar = caldav({
 *   serverUrl: 'https://caldav.fastmail.com/dav/',
 *   username: 'me@fastmail.com',
 *   password: process.env.FASTMAIL_APP_PASSWORD,
 * });
 */
export function caldav(settings: CaldavSettings): CaldavProvider {
  const serverUrl = parseServerUrl(settings.serverUrl);
  if (settings.timeZone !== undefined && !isValidTimeZone(settings.timeZone)) {
    throw new InvalidArgumentError({
      argument: 'timeZone',
      message: `"${settings.timeZone}" is not an IANA time zone.`,
    });
  }
  const client = createDavClient({
    serverUrl,
    username: settings.username,
    password: settings.password,
    headers: settings.headers,
    fetch: settings.fetch,
  });

  // Discovery takes several requests, so it runs once. A failed one is tried again.
  let discovery: Promise<Discovery> | undefined;
  function discovered(call: Call) {
    discovery ??= discover(client, serverUrl, call).catch((error: unknown) => {
      discovery = undefined;
      throw error;
    });
    return discovery;
  }

  async function calendarUrl(calendarId: string, call: Call): Promise<URL> {
    const { home, primary } = await discovered(call);
    if (calendarId === 'primary') return primary;
    let url: URL;
    try {
      url = withSlash(new URL(calendarId, home));
    } catch {
      url = home;
    }
    if (url.origin !== home.origin || url.href === home.href) {
      throw new InvalidArgumentError({
        argument: 'calendarId',
        message: 'Calendar ids are the paths of calendars, as listCalendars returns them.',
      });
    }
    return url;
  }

  /** Runs one operation, mapping HTTP errors to calsdk errors for the calendar or event. */
  async function run<Result>(
    calendarId: string,
    eventId: string | undefined,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      throw mapAPICallError(error, {
        provider: PROVIDER,
        resource: eventId ? { type: 'event', id: eventId } : { type: 'calendar', id: calendarId },
        eventId,
      });
    }
  }

  function toResource(
    calendarId: string,
    url: URL,
    etag: string | undefined,
    text: string,
  ): Resource | undefined {
    const id = resourceId(url);
    if (id === undefined) return undefined;
    const calendar = parseICalendar(text, { calendarId, defaultTimeZone: settings.timeZone });
    const group = calendar.groups.values().next().value;
    return group && { id, url, etag, calendar, group: { ...group, id } };
  }

  async function getResource(calendarId: string, url: URL, call: Call) {
    const response = await client.request({ method: 'GET', url, call, allow: [404, 410] });
    if (response.status === 404 || response.status === 410) return undefined;
    return toResource(calendarId, url, response.etag, response.text);
  }

  /** Finds what an event id points at: its resource, or an instance of a series. */
  async function locate(calendarId: string, eventId: string, call: Call): Promise<Target> {
    const calendar = await calendarUrl(calendarId, call);
    const notFound = () =>
      new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });

    const direct = await getResource(calendarId, eventUrl(calendar, eventId), call);
    if (direct?.group.master) return { resource: direct };

    const separator = eventId.lastIndexOf('_');
    if (separator <= 0) throw notFound();
    const resource = await getResource(
      calendarId,
      eventUrl(calendar, eventId.slice(0, separator)),
      call,
    );
    if (!resource) throw notFound();
    const instance = findEvent(
      new Map([[resource.id, resource.group]]),
      eventId,
      resource.calendar.context,
      [],
    );
    if (!instance || instance.id === resource.id) throw notFound();
    return { resource, instance };
  }

  /** Writes a resource back, unless someone changed it since it was read. */
  async function save(resource: Resource, ifMatch: string | undefined, call: Call) {
    await client.request({
      method: 'PUT',
      url: resource.url,
      call,
      body: resource.calendar.component.toString(),
      headers: { 'if-match': ifMatch ?? resource.etag },
    });
  }

  /** Reads an event of a resource again after a write, as the server stored it. */
  async function reread(calendarId: string, resource: Resource, eventId: string, call: Call) {
    const stored = await getResource(calendarId, resource.url, call);
    const event =
      stored &&
      findEvent(new Map([[stored.id, stored.group]]), eventId, stored.calendar.context, []);
    if (!stored || !event) {
      throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
    }
    return { ...event, etag: stored.etag };
  }

  const thisAndFollowing = () =>
    new UnsupportedFunctionalityError({
      provider: PROVIDER,
      functionality: "scope 'thisAndFollowing'",
    });

  return {
    specificationVersion: 'v1',
    provider: PROVIDER,
    capabilities: {
      events: {
        details: true,
        allDay: true,
        recurrence: true,
        recurrenceScopeThisAndFollowing: false,
        serverSideExpansion: true,
        attendees: true,
        conference: false,
        reminders: false,
        color: false,
        etag: true,
        search: false,
      },
      freeBusy: false,
      sync: true,
      webhooks: false,
    },

    async doListCalendars(call) {
      return run('primary', undefined, async () => {
        const { home, primary } = await discovered(call);
        const calendars = await listDavCalendars(client, home, call);
        return {
          calendars: calendars.map(({ url, ...calendar }) => ({
            ...calendar,
            timeZone: settings.timeZone,
            isPrimary: url.pathname === primary.pathname,
          })),
          warnings: [],
        };
      });
    },

    async doGetEvent({ calendarId, eventId, ...call }) {
      return run(calendarId, eventId, async () => {
        const { resource, instance } = await locate(calendarId, eventId, call);
        const event = instance ?? masterOf(resource.group, resource.calendar.context);
        if (!event) throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
        return { event: { ...event, etag: resource.etag }, warnings: [] };
      });
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
      const min = Date.parse(timeMin);
      const max = Date.parse(timeMax);
      return run(calendarId, undefined, async () => {
        const url = await calendarUrl(calendarId, call);
        // A day of slack: servers read all-day and floating times in a zone of their own.
        const response = await client.request({
          method: 'REPORT',
          url,
          depth: '1',
          call,
          body: calendarQuery(min - DAY_MS, max + DAY_MS),
        });
        const warnings: WarningV1[] = [];
        const events: { start: number; event: EventV1 }[] = [];
        for (const item of parseMultistatus(response.text, response.url).resources) {
          const data = propText(item, CALDAV, 'calendar-data');
          const resource =
            data && toResource(calendarId, item.url, propText(item, DAV, 'getetag'), data);
          if (!resource) continue;
          const { context } = resource.calendar;
          const instances = instancesBetween(resource.group, context, min, max, warnings);
          const master = masterOf(resource.group, context);
          // Unexpanded listings return series that have an instance in the window.
          const matches =
            expandRecurring || !master ? instances : instances.length > 0 ? [master] : [];
          for (const event of matches) {
            events.push({
              start: eventTimeToInstant(event.start, context.timeZone),
              event: { ...event, etag: resource.etag },
            });
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
      });
    },

    async doCreateEvent({ calendarId, event, sendUpdates, ...call }) {
      return run(calendarId, undefined, async () => {
        const url = await calendarUrl(calendarId, call);
        const { emails } = await discovered(call);
        const warnings: WarningV1[] = [];
        const uid = crypto.randomUUID();
        const calendar = newCalendar(uid, event, { organizer: emails[0], warnings });
        setScheduleAgent(calendar, sendUpdates, warnings);
        const resourceUrl = eventUrl(url, uid);
        await client.request({
          method: 'PUT',
          url: resourceUrl,
          call,
          body: calendar.toString(),
          headers: { 'if-none-match': '*' },
        });
        const stored = await getResource(calendarId, resourceUrl, call);
        const created = stored && masterOf(stored.group, stored.calendar.context);
        if (!stored || !created) {
          throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: uid });
        }
        return { event: { ...created, etag: stored.etag }, warnings };
      });
    },

    async doUpdateEvent({
      calendarId,
      eventId,
      patch,
      scope = 'this',
      ifMatch,
      sendUpdates,
      ...call
    }) {
      return run(calendarId, eventId, async () => {
        const { resource, instance } = await locate(calendarId, eventId, call);
        const { emails } = await discovered(call);
        const { group, calendar } = resource;
        const { context } = calendar;
        const master = group.master;
        if (!master)
          throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
        const warnings: WarningV1[] = [];
        const options = { organizer: emails[0], warnings };

        let targetId = resource.id;
        if (!instance) {
          applyPatch(master, patch, options);
          touch(master, true);
          if (patch.start || patch.recurrence !== undefined) dropOrphanedExceptions(resource);
        } else if (patch.recurrence !== undefined) {
          throw new InvalidArgumentError({
            argument: 'patch.recurrence',
            message:
              'Recurrence cannot be changed through a single instance. Update the series id instead.',
          });
        } else if (scope === 'thisAndFollowing') {
          throw thisAndFollowing();
        } else if (scope === 'all') {
          const series = masterOf(group, context);
          if (!series)
            throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
          const { start, end, ...rest } = patch;
          applyPatch(master, rest, options);
          if (start)
            setTime(master, 'dtstart', shiftTime(series.start, instance.start, start, context));
          if (end) {
            master.removeAllProperties('duration');
            setTime(master, 'dtend', shiftTime(series.end, instance.end, end, context));
          }
          touch(master, true);
          if (start) dropOrphanedExceptions(resource);
        } else {
          let exception = group.exceptions.find(
            (component) => `${resource.id}_${recurrenceKey(component, context)}` === eventId,
          );
          if (!exception) {
            exception = newException(
              master,
              instanceProperty(
                'recurrence-id',
                master,
                instance.originalStart ?? instance.start,
                context,
              ),
            );
            setTime(exception, 'dtstart', instance.start);
            setTime(exception, 'dtend', instance.end);
            calendar.component.addSubcomponent(exception);
            group.exceptions.push(exception);
          }
          applyPatch(exception, patch, options);
          touch(exception, true);
          targetId = eventId;
        }

        const written = findEvent(new Map([[resource.id, group]]), targetId, context, []);
        if (written && instant(written.end, context) < instant(written.start, context)) {
          throw new InvalidArgumentError({
            argument: 'patch',
            message: 'The event would end before it starts.',
          });
        }
        setScheduleAgent(calendar.component, sendUpdates, warnings);
        await save(resource, ifMatch, call);
        return { event: await reread(calendarId, resource, targetId, call), warnings };
      });
    },

    async doDeleteEvent({ calendarId, eventId, scope = 'this', ifMatch, sendUpdates, ...call }) {
      return run(calendarId, eventId, async () => {
        const url = await calendarUrl(calendarId, call);
        const warnings: WarningV1[] = [];
        const direct = await client.request({
          method: 'DELETE',
          url: eventUrl(url, eventId),
          call,
          headers: { 'if-match': ifMatch },
          allow: [404, 410],
        });
        if (direct.status !== 404 && direct.status !== 410) return { warnings };

        const { resource, instance } = await locate(calendarId, eventId, call);
        if (!instance) {
          throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
        }
        if (scope === 'thisAndFollowing') throw thisAndFollowing();
        if (scope === 'all') {
          await client.request({
            method: 'DELETE',
            url: resource.url,
            call,
            headers: { 'if-match': ifMatch ?? resource.etag },
          });
          return { warnings };
        }

        const { group, calendar } = resource;
        const master = group.master;
        if (!master)
          throw new NotFoundError({ provider: PROVIDER, resource: 'event', id: eventId });
        for (const exception of group.exceptions) {
          if (`${resource.id}_${recurrenceKey(exception, calendar.context)}` === eventId) {
            calendar.component.removeSubcomponent(exception);
          }
        }
        master.addProperty(
          instanceProperty(
            'exdate',
            master,
            instance.originalStart ?? instance.start,
            calendar.context,
          ),
        );
        touch(master, true);
        setScheduleAgent(calendar.component, sendUpdates, warnings);
        await save(resource, ifMatch, call);
        return { warnings };
      });
    },

    /**
     * Reports what changed since the cursor with the server's sync tokens (RFC 6578): single
     * events, series and their exceptions, never computed occurrences.
     */
    async doSyncEvents({ calendarId, cursor, pageToken, ...call }) {
      if (pageToken !== undefined) {
        throw new InvalidArgumentError({
          argument: 'pageToken',
          message: 'The CalDAV provider returns every change on one page.',
        });
      }
      const previous = cursor ? decodeSyncCursor(cursor) : undefined;
      return run(calendarId, undefined, async () => {
        const url = await calendarUrl(calendarId, call);
        const exceptions = new Map(previous?.exceptions);
        const changed = new Map<string, URL>();
        const deleted = new Set<string>();

        let syncToken = previous?.syncToken ?? '';
        for (let round = 0; ; round++) {
          let response: Awaited<ReturnType<typeof client.request>>;
          try {
            response = await client.request({
              method: 'REPORT',
              url,
              depth: '0',
              call,
              body: syncCollection(syncToken),
            });
          } catch (error) {
            if (previous && isInvalidSyncToken(error)) {
              throw new SyncCursorExpiredError({ provider: PROVIDER, calendarId, cause: error });
            }
            throw error;
          }
          const result = parseMultistatus(response.text, response.url);
          let truncated = false;
          for (const item of result.resources) {
            if (withSlash(item.url).pathname === url.pathname) {
              // The server returned part of the changes: ask again from the new token.
              truncated = item.status === 507;
              continue;
            }
            const id = resourceId(item.url);
            if (id === undefined) continue;
            if (item.status === 404 || item.status === 410) {
              changed.delete(id);
              // Some servers (Radicale) list resources deleted long ago in an initial sync.
              if (previous) deleted.add(id);
            } else {
              deleted.delete(id);
              changed.set(id, item.url);
            }
          }
          if (!result.syncToken) {
            throw new APICallError({
              message: 'The CalDAV server answered a sync without a sync token.',
              url: url.href,
              isRetryable: false,
            });
          }
          syncToken = result.syncToken;
          if (!truncated || round === MAX_SYNC_ROUNDS) break;
        }

        const changes: SyncChangeV1[] = [];
        const removeAll = (id: string) => {
          changes.push({ type: 'delete', eventId: id });
          for (const key of exceptions.get(id) ?? []) {
            if (!key.startsWith(CANCELLED))
              changes.push({ type: 'delete', eventId: `${id}_${key}` });
          }
          exceptions.delete(id);
        };
        for (const id of deleted) removeAll(id);

        const urls = [...changed.values()];
        for (let index = 0; index < urls.length; index += MULTIGET_BATCH) {
          const batch = urls.slice(index, index + MULTIGET_BATCH);
          const response = await client.request({
            method: 'REPORT',
            url,
            depth: '1',
            call,
            body: calendarMultiget(batch),
          });
          const found = new Set<string>();
          for (const item of parseMultistatus(response.text, response.url).resources) {
            const data = propText(item, CALDAV, 'calendar-data');
            const resource =
              data && toResource(calendarId, item.url, propText(item, DAV, 'getetag'), data);
            if (!resource) continue;
            found.add(resource.id);
            const events = storedEvents(resource.group, resource.calendar.context);
            const keys = new Set(events.flatMap((event) => instanceKeyOf(resource.id, event)));
            const known = new Set(exceptions.get(resource.id));
            for (const key of known) {
              if (!key.startsWith(CANCELLED) && !keys.has(key))
                changes.push({ type: 'delete', eventId: `${resource.id}_${key}` });
            }
            // An instance cancelled by a STATUS:CANCELLED exception is deleted once, when the
            // cancellation first appears, in a first sync too. An exception it replaced was
            // deleted just above.
            for (const key of cancelledKeys(resource.group, resource.calendar.context)) {
              if (!known.has(key) && !known.has(`${CANCELLED}${key}`))
                changes.push({ type: 'delete', eventId: `${resource.id}_${key}` });
              keys.add(`${CANCELLED}${key}`);
            }
            if (keys.size > 0) exceptions.set(resource.id, [...keys]);
            else exceptions.delete(resource.id);
            for (const event of events) {
              changes.push({ type: 'upsert', event: { ...event, etag: resource.etag } });
            }
          }
          // Deleted since the sync report, or not an event (a task in a mixed calendar).
          for (const url of batch) {
            const id = resourceId(url);
            if (id !== undefined && !found.has(id) && previous) removeAll(id);
          }
        }

        const next: SyncCursor = { syncToken, exceptions: [...exceptions] };
        return { changes, nextCursor: encodeToken(next), warnings: [] };
      });
    },
  };
}

/**
 * Creates a provider for iCloud Calendar. Sign in with an app-specific password, made at
 * account.apple.com under Sign-In and Security: iCloud does not accept the account password.
 *
 * @example
 * import { icloud } from '@calsdk/caldav';
 * const calendar = icloud({ appleId: 'me@icloud.com', appPassword: process.env.ICLOUD_APP_PASSWORD });
 */
export function icloud({
  appleId,
  appPassword,
  ...settings
}: Omit<CaldavSettings, 'serverUrl' | 'username' | 'password'> & {
  appleId: string;
  appPassword: string;
}): CaldavProvider {
  return caldav({
    ...settings,
    serverUrl: 'https://caldav.icloud.com/',
    username: appleId,
    password: appPassword,
  });
}

function parseServerUrl(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new InvalidArgumentError({ argument: 'serverUrl', message: 'serverUrl is not a URL.' });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidArgumentError({
      argument: 'serverUrl',
      message: `CalDAV runs over HTTP(S), not ${url.protocol}`,
    });
  }
  return url;
}

/** The id of an event resource: its name without `.ics`. Other names are not events calsdk can address. */
function resourceId(url: URL): string | undefined {
  const name = url.pathname.split('/').at(-1) ?? '';
  if (!name.toLowerCase().endsWith('.ics')) return undefined;
  try {
    return decodeURIComponent(name.slice(0, -'.ics'.length));
  } catch {
    return undefined;
  }
}

const eventUrl = (calendar: URL, id: string) => new URL(`${encodeURIComponent(id)}.ics`, calendar);

/** The instance key of an exception event, from its id. */
function instanceKeyOf(resourceId: string, event: EventV1): string[] {
  return event.kind === 'exception' ? [event.id.slice(resourceId.length + 1)] : [];
}

/** Drops exceptions of instances a changed series no longer has. */
function dropOrphanedExceptions(resource: Resource) {
  const { group, calendar } = resource;
  if (!group.master) return;
  const series = new Map([[resource.id, { ...group, exceptions: [] }]]);
  group.exceptions = group.exceptions.filter((exception) => {
    const key = recurrenceKey(exception, calendar.context);
    const kept =
      key !== undefined &&
      findEvent(series, `${resource.id}_${key}`, calendar.context, []) !== undefined;
    if (!kept) calendar.component.removeSubcomponent(exception);
    return kept;
  });
}

/** Moves `time` by as much as an instance moves from `from` to `to`, like the mock provider. */
function shiftTime(
  time: EventTimeV1,
  from: EventTimeV1,
  to: EventTimeV1,
  context: ReadContext,
): EventTimeV1 {
  if (isAllDay(time) && isAllDay(from) && isAllDay(to)) {
    const days = Math.round((Date.parse(to.date) - Date.parse(from.date)) / DAY_MS);
    return { date: addDaysToDate(time.date, days) };
  }
  if (!isAllDay(time) && !isAllDay(to)) {
    const delta = instant(to, context) - instant(from, context);
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

const instant = (time: EventTimeV1, context: ReadContext) =>
  eventTimeToInstant(time, context.timeZone);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const isAfter = (item: { start: number; event: EventV1 }, token: ListToken) =>
  item.start > token.start || (item.start === token.start && compare(item.event.id, token.id) > 0);

/** A sync token the server no longer accepts (RFC 6578, section 3.2). */
function isInvalidSyncToken(error: unknown): boolean {
  return (
    APICallError.isInstance(error) &&
    (error.statusCode === 403 || error.statusCode === 409 || error.statusCode === 410) &&
    (error.statusCode === 410 || (error.responseBody ?? '').includes('valid-sync-token'))
  );
}

const utc = (instantMs: number) => formatICalDate(instantToICalDate(instantMs));

const XML_HEAD = `<?xml version="1.0" encoding="utf-8"?>`;

function calendarQuery(min: number, max: number) {
  return `${XML_HEAD}<C:calendar-query xmlns:D="${DAV}" xmlns:C="${CALDAV}"><D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="${utc(min)}" end="${utc(max)}"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`;
}

function calendarMultiget(urls: URL[]) {
  const hrefs = urls.map((url) => `<D:href>${xml(url.pathname)}</D:href>`).join('');
  return `${XML_HEAD}<C:calendar-multiget xmlns:D="${DAV}" xmlns:C="${CALDAV}"><D:prop><D:getetag/><C:calendar-data/></D:prop>${hrefs}</C:calendar-multiget>`;
}

function syncCollection(token: string) {
  return `${XML_HEAD}<D:sync-collection xmlns:D="${DAV}"><D:sync-token>${xml(token)}</D:sync-token><D:sync-level>1</D:sync-level><D:prop><D:getetag/></D:prop></D:sync-collection>`;
}
