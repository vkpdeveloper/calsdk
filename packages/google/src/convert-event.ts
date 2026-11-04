import {
  type AttendeeV1,
  type ConferenceV1,
  type EventPatchV1,
  type EventTimeV1,
  type EventV1,
  InvalidResponseDataError,
  type WarningV1,
} from '@calsdk/provider';
import { formatZonedDateTime, isAllDay, isValidTimeZone } from '@calsdk/provider-utils';
import type { GoogleEvent, GoogleTime } from './google-api';
import { GOOGLE_EVENT_COLORS, nearestColorId } from './google-colors';
import type { GoogleEventMetadata } from './google-options';

/** Whether any time on the event lacks its own zone, so the calendar's zone is needed. */
export function needsCalendarZone(raw: GoogleEvent): boolean {
  return [raw.start, raw.end, raw.originalStartTime].some(
    (time) => time?.dateTime !== undefined && time.timeZone === undefined,
  );
}

/**
 * Converts a Google time. Timed values get the offset of their zone, so `dateTime` and
 * `timeZone` always agree. Google omits the zone when the event uses the calendar's.
 */
export function fromGoogleTime(time: GoogleTime | undefined, fallbackZone?: string): EventTimeV1 {
  if (time?.date !== undefined) return { date: time.date };
  const instant = Date.parse(time?.dateTime ?? '');
  if (Number.isNaN(instant)) {
    throw new InvalidResponseDataError({
      data: time,
      message: 'Google returned an event time with neither a date nor a valid dateTime.',
    });
  }
  const timeZone =
    [time?.timeZone, fallbackZone].find((zone) => zone !== undefined && isValidTimeZone(zone)) ??
    'UTC';
  return { dateTime: formatZonedDateTime(instant, timeZone), timeZone };
}

export function toGoogleTime(time: EventTimeV1, clearOther: boolean) {
  if (isAllDay(time)) {
    return clearOther ? { date: time.date, dateTime: null, timeZone: null } : { date: time.date };
  }
  return clearOther
    ? { dateTime: time.dateTime, timeZone: time.timeZone, date: null }
    : { dateTime: time.dateTime, timeZone: time.timeZone };
}

const RESPONSE_STATUSES = new Set<string>(['needsAction', 'accepted', 'declined', 'tentative']);

export function fromGoogleEvent(
  raw: GoogleEvent,
  {
    calendarId,
    timeZone,
    isException,
  }: {
    calendarId: string;
    /** The calendar's zone, for times without one. */
    timeZone: string | undefined;
    /** Whether an instance was modified. Google does not say so on expanded instances. */
    isException: boolean;
  },
): EventV1 {
  const isSeries = (raw.recurrence?.length ?? 0) > 0 && raw.recurringEventId === undefined;
  const start = fromGoogleTime(raw.start, timeZone);
  const metadata: GoogleEventMetadata = {
    iCalUID: raw.iCalUID,
    eventType: raw.eventType,
    extendedProperties: raw.extendedProperties,
  };

  return {
    id: raw.id,
    calendarId,
    kind: isSeries
      ? 'series'
      : raw.recurringEventId === undefined
        ? 'single'
        : isException
          ? 'exception'
          : 'occurrence',
    ...(raw.recurringEventId !== undefined && {
      seriesId: raw.recurringEventId,
      originalStart: raw.originalStartTime
        ? fromGoogleTime(raw.originalStartTime, raw.start?.timeZone ?? timeZone)
        : start,
    }),
    title: raw.summary,
    description: raw.description,
    location: raw.location,
    start,
    end: fromGoogleTime(raw.end, timeZone),
    recurrence: isSeries ? raw.recurrence : undefined,
    // Google only returns `cancelled` for deleted events, which callers filter out.
    status: raw.status === 'tentative' ? 'tentative' : 'confirmed',
    showAs: raw.transparency === 'transparent' ? 'free' : 'busy',
    visibility:
      raw.visibility === 'confidential'
        ? 'private'
        : raw.visibility === 'default' ||
            raw.visibility === 'public' ||
            raw.visibility === 'private'
          ? raw.visibility
          : undefined,
    organizer: raw.organizer?.email
      ? { email: raw.organizer.email, name: raw.organizer.displayName, self: raw.organizer.self }
      : undefined,
    attendees: raw.attendees?.flatMap((attendee): AttendeeV1[] =>
      attendee.email
        ? [
            {
              email: attendee.email,
              name: attendee.displayName,
              self: attendee.self,
              responseStatus: RESPONSE_STATUSES.has(attendee.responseStatus ?? '')
                ? (attendee.responseStatus as AttendeeV1['responseStatus'])
                : 'needsAction',
              optional: attendee.optional,
              organizer: attendee.organizer,
            },
          ]
        : [],
    ),
    conference: fromGoogleConference(raw),
    reminders: raw.reminders && {
      useDefault: raw.reminders.useDefault ?? false,
      overrides: raw.reminders.overrides?.flatMap(({ method, minutes }) =>
        method === 'popup' || method === 'email' ? [{ method, minutesBefore: minutes }] : [],
      ),
    },
    color: raw.colorId === undefined ? undefined : GOOGLE_EVENT_COLORS[raw.colorId],
    htmlLink: raw.htmlLink,
    etag: raw.etag,
    createdAt: raw.created,
    updatedAt: raw.updated,
    providerMetadata: { google: metadata },
  };
}

function fromGoogleConference(raw: GoogleEvent): ConferenceV1 | undefined {
  const data = raw.conferenceData;
  const joinUrl =
    data?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri ?? raw.hangoutLink;
  if (joinUrl === undefined) return undefined;
  const type = data?.conferenceSolution?.key?.type;
  let host = '';
  try {
    host = new URL(joinUrl).hostname;
  } catch {
    // Not a URL: the provider stays 'other'.
  }
  const provider =
    type === 'hangoutsMeet' || host === 'meet.google.com'
      ? 'google-meet'
      : host === 'zoom.us' || host.endsWith('.zoom.us')
        ? 'zoom'
        : 'other';
  return { provider, joinUrl, id: data?.conferenceId };
}

/** Request body for creating or patching a Google event. `null` clears a field. */
export type GoogleEventWrite = {
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: ReturnType<typeof toGoogleTime>;
  end?: ReturnType<typeof toGoogleTime>;
  recurrence?: string[];
  transparency?: 'opaque' | 'transparent';
  visibility?: 'default' | 'public' | 'private';
  attendees?: { email: string; displayName?: string; optional?: boolean }[];
  conferenceData?:
    | GoogleEvent['conferenceData']
    | { createRequest: { requestId: string; conferenceSolutionKey: { type: 'hangoutsMeet' } } }
    | null;
  reminders?: {
    useDefault: boolean;
    overrides?: { method: 'popup' | 'email'; minutes: number }[];
  };
  colorId?: string | null;
};

/**
 * Converts a patch (or a full event input) to a Google request body.
 * `mode: 'patch'` also clears fields set to `null` and the unused half of a time.
 */
export function toGoogleWrite(
  patch: EventPatchV1,
  mode: 'create' | 'patch',
  warnings: WarningV1[],
): GoogleEventWrite {
  const body: GoogleEventWrite = {};
  const clear = mode === 'patch';
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.start !== undefined) body.start = toGoogleTime(patch.start, clear);
  if (patch.end !== undefined) body.end = toGoogleTime(patch.end, clear);
  if (patch.recurrence !== undefined) body.recurrence = patch.recurrence ?? [];
  if (patch.showAs !== undefined) {
    body.transparency = patch.showAs === 'free' ? 'transparent' : 'opaque';
  }
  if (patch.visibility !== undefined) body.visibility = patch.visibility ?? 'default';
  if (patch.attendees !== undefined) {
    body.attendees = (patch.attendees ?? []).map(({ email, name, optional }) => ({
      email,
      displayName: name,
      optional,
    }));
  }
  if (patch.createConference === true) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  } else if (clear && patch.createConference !== undefined) {
    body.conferenceData = null;
  }
  if (patch.reminders !== undefined) {
    body.reminders = patch.reminders
      ? {
          useDefault: patch.reminders.useDefault,
          overrides: patch.reminders.useDefault
            ? undefined
            : patch.reminders.overrides?.map(({ method, minutesBefore }) => ({
                method,
                minutes: minutesBefore,
              })),
        }
      : { useDefault: true };
  }
  if (patch.color === null) {
    body.colorId = null;
  } else if (patch.color !== undefined) {
    const { colorId, exact } = nearestColorId(patch.color);
    body.colorId = colorId;
    if (!exact) {
      warnings.push({
        type: 'compatibility',
        feature: 'color',
        details: `Google Calendar has a fixed palette. ${patch.color} was saved as the nearest color, ${GOOGLE_EVENT_COLORS[colorId]}.`,
      });
    }
  }
  return body;
}
