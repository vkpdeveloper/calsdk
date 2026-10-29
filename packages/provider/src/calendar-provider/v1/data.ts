import type { ProviderMetadataV1 } from './shared';

/** A calendar the authenticated user can see. */
export type CalendarV1 = {
  id: string;
  name: string;
  description?: string;
  /** IANA time zone, e.g. `'Asia/Kolkata'`. */
  timeZone?: string;
  /** Hex color, `'#RRGGBB'`. */
  color?: string;
  /** The user's default calendar. The calendar id `'primary'` always resolves to it. */
  isPrimary: boolean;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  providerMetadata?: ProviderMetadataV1;
};

/**
 * When an event starts or ends.
 *
 * Timed events use `dateTime` + `timeZone`. All-day events use `date` only.
 * An event never mixes the two: `start` and `end` are both timed or both all-day.
 */
export type EventTimeV1 =
  | {
      /** ISO 8601 date-time with an offset, e.g. `'2026-11-03T10:00:00+05:30'`. */
      dateTime: string;
      /** IANA time zone the event was scheduled in, e.g. `'Asia/Kolkata'`. */
      timeZone: string;
      date?: never;
    }
  | {
      /** `'YYYY-MM-DD'`. For `end`, the date is exclusive: a one-day event on the 3rd ends on the 4th. */
      date: string;
      dateTime?: never;
      timeZone?: never;
    };

/**
 * - `single`: a non-recurring event.
 * - `series`: the master of a recurring event. Has `recurrence`.
 * - `occurrence`: an unmodified instance of a series.
 * - `exception`: an instance of a series that was modified.
 */
export type EventKindV1 = 'single' | 'series' | 'occurrence' | 'exception';

export type PersonV1 = {
  email: string;
  name?: string;
  /** `true` when this person is the authenticated user. */
  self?: boolean;
};

export type AttendeeV1 = PersonV1 & {
  responseStatus: 'needsAction' | 'accepted' | 'declined' | 'tentative';
  optional?: boolean;
  organizer?: boolean;
};

export type ConferenceV1 = {
  provider: 'google-meet' | 'teams' | 'zoom' | 'other';
  joinUrl: string;
  id?: string;
};

export type RemindersV1 = {
  /** `true` uses the calendar's default reminders and ignores `overrides`. */
  useDefault: boolean;
  overrides?: { method: 'popup' | 'email'; minutesBefore: number }[];
};

export type EventV1 = {
  id: string;
  calendarId: string;
  kind: EventKindV1;
  /** Id of the series this event belongs to. Set for `occurrence` and `exception`. */
  seriesId?: string;
  /** Start of this instance according to the series rule. Set for `occurrence` and `exception`. */
  originalStart?: EventTimeV1;
  title?: string;
  description?: string;
  location?: string;
  start: EventTimeV1;
  end: EventTimeV1;
  /** RFC 5545 lines, e.g. `['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE:20261110T100000Z']`. Set for `series`. */
  recurrence?: string[];
  /**
   * `cancelled` is for events that still have full details, such as a Microsoft meeting the
   * organizer cancelled. Deleted events and cancelled occurrences of a series are not events:
   * `listEvents` omits them and `syncEvents` reports them as `delete` changes.
   */
  status: 'confirmed' | 'tentative' | 'cancelled';
  /** Whether the event blocks time on free/busy queries. */
  showAs: 'busy' | 'free';
  visibility?: 'default' | 'public' | 'private';
  organizer?: PersonV1;
  attendees?: AttendeeV1[];
  conference?: ConferenceV1;
  reminders?: RemindersV1;
  /** Hex color, `'#RRGGBB'`. */
  color?: string;
  /** Link to the event in the provider's web UI. */
  htmlLink?: string;
  /** Version tag. Pass it as `ifMatch` to update or delete only if nobody changed the event since. */
  etag?: string;
  /** ISO 8601 timestamp. */
  createdAt?: string;
  /** ISO 8601 timestamp. */
  updatedAt?: string;
  providerMetadata?: ProviderMetadataV1;
};

/** Fields an app can set when creating an event. */
export type EventInputV1 = {
  title?: string;
  description?: string;
  location?: string;
  start: EventTimeV1;
  end: EventTimeV1;
  /** RFC 5545 lines, e.g. `['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10']`. */
  recurrence?: string[];
  /** Defaults to `'busy'`. */
  showAs?: 'busy' | 'free';
  visibility?: 'default' | 'public' | 'private';
  attendees?: { email: string; name?: string; optional?: boolean }[];
  /** Ask the provider to create a meeting link (Meet on Google, Teams on Microsoft). */
  createConference?: boolean;
  reminders?: RemindersV1;
  /** Hex color, `'#RRGGBB'`. Providers with a fixed palette pick the nearest color and warn. */
  color?: string;
};

/**
 * A partial update. Only provided fields change, `null` clears a field.
 * `start` and `end` cannot be cleared, only replaced.
 */
export type EventPatchV1 = {
  [K in keyof EventInputV1]?: K extends 'start' | 'end' ? EventInputV1[K] : EventInputV1[K] | null;
};
