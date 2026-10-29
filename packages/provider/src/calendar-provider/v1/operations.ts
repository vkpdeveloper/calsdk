import type { CalendarV1, EventInputV1, EventPatchV1, EventV1 } from './data';
import type { CallOptionsV1, ResultBaseV1 } from './shared';

/** Whether attendees get notified about a change. */
export type SendUpdatesV1 = 'all' | 'externalOnly' | 'none';

/**
 * Which part of a recurring event a write applies to.
 *
 * - `this`: only the targeted instance.
 * - `all`: the whole series.
 * - `thisAndFollowing`: the targeted instance and every later one.
 */
export type UpdateScopeV1 = 'this' | 'all' | 'thisAndFollowing';

export type ListCalendarsOptionsV1 = CallOptionsV1;
export type ListCalendarsResultV1 = ResultBaseV1 & { calendars: CalendarV1[] };

export type GetEventOptionsV1 = CallOptionsV1 & {
  calendarId: string;
  eventId: string;
};
export type EventResultV1 = ResultBaseV1 & { event: EventV1 };

export type ListEventsOptionsV1 = CallOptionsV1 & {
  calendarId: string;
  /** ISO 8601 lower bound (inclusive) on event end. */
  timeMin: string;
  /** ISO 8601 upper bound (exclusive) on event start. */
  timeMax: string;
  /**
   * `true`: return singles, occurrences and exceptions, ordered by start.
   * `false`: return singles and series masters.
   */
  expandRecurring: boolean;
  /** Free-text search. Only honored when `capabilities.events.search` is supported. */
  query?: string;
  /** Upper bound on events per page. Providers may return fewer. */
  pageSize?: number;
  /** `nextPageToken` from the previous page. */
  pageToken?: string;
};
export type ListEventsResultV1 = ResultBaseV1 & {
  events: EventV1[];
  /** Present when more pages exist. */
  nextPageToken?: string;
};

export type CreateEventOptionsV1 = CallOptionsV1 & {
  calendarId: string;
  event: EventInputV1;
  sendUpdates?: SendUpdatesV1;
};

export type UpdateEventOptionsV1 = CallOptionsV1 & {
  calendarId: string;
  eventId: string;
  patch: EventPatchV1;
  /** Only meaningful when `eventId` is an occurrence or exception. Defaults to `'this'`. */
  scope?: UpdateScopeV1;
  /** Only update if the event's current `etag` matches. Mismatch throws `ConflictError`. */
  ifMatch?: string;
  sendUpdates?: SendUpdatesV1;
};

export type DeleteEventOptionsV1 = CallOptionsV1 & {
  calendarId: string;
  eventId: string;
  /** Only meaningful when `eventId` is an occurrence or exception. Defaults to `'this'`. */
  scope?: UpdateScopeV1;
  /** Only delete if the event's current `etag` matches. Mismatch throws `ConflictError`. */
  ifMatch?: string;
  sendUpdates?: SendUpdatesV1;
};
export type DeleteEventResultV1 = ResultBaseV1;

export type FreeBusyOptionsV1 = CallOptionsV1 & {
  calendarIds: string[];
  /** ISO 8601. */
  timeMin: string;
  /** ISO 8601. */
  timeMax: string;
};

/** A busy interval. Both bounds are ISO 8601 instants, `end` exclusive. */
export type BusyBlockV1 = { start: string; end: string };

export type FreeBusyResultV1 = ResultBaseV1 & {
  /** Keyed by the requested calendar id. `error` is set when one calendar could not be read. */
  calendars: Record<string, { busy: BusyBlockV1[]; error?: string }>;
};

export type SyncEventsOptionsV1 = CallOptionsV1 & {
  calendarId: string;
  /** Omit for the initial full sync. Opaque: store it, never parse it. */
  cursor?: string;
  /** `nextPageToken` from the previous page of the same sync round. */
  pageToken?: string;
};

export type SyncChangeV1 = { type: 'upsert'; event: EventV1 } | { type: 'delete'; eventId: string };

export type SyncEventsResultV1 = ResultBaseV1 & {
  changes: SyncChangeV1[];
  /** More pages exist in this sync round. */
  nextPageToken?: string;
  /** Present on the last page. Store it and pass it as `cursor` on the next sync. */
  nextCursor?: string;
};
