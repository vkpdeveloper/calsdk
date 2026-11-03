import type { AttendeeV1, EventTimeV1, EventV1 } from '@calsdk/provider';
import {
  formatRdates,
  formatZonedDateTime,
  instantToICalDate,
  isValidTimeZone,
} from '@calsdk/provider-utils';
import { fromZoomRecurrence } from './convert-recurrence';
import { type Meeting, type Occurrence, RECURRING } from './zoom-api';
import type { ZoomEventMetadata } from './zoom-options';

const MINUTE = 60_000;

/** `20300107T150000Z`: the original start of an occurrence, as it ends its event id. */
function stampOf(instant: number): string {
  return new Date(instant).toISOString().replace(/[-:]|\.\d{3}/g, '');
}

/**
 * An event id: the meeting id for meetings and series, and `<meeting id>_<original start>`
 * for an occurrence of a series.
 */
export function instanceId(meetingId: number | string, originalStart: number): string {
  return `${meetingId}_${stampOf(originalStart)}`;
}

/** The meeting id and, for an occurrence, its original start. */
export function parseEventId(eventId: string): { meetingId: string; originalStart?: number } {
  const match = /^(.+)_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(eventId);
  if (!match) return { meetingId: eventId };
  const [, meetingId = '', ...parts] = match;
  const [year, month, day, hour, minute, second] = parts.map(Number);
  return {
    meetingId,
    originalStart: Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute, second),
  };
}

/** Zoom names an occurrence by its original start in epoch milliseconds. */
export const originalStartOf = (occurrence: Occurrence) => Number(occurrence.occurrence_id);

export const isDeleted = (occurrence: Occurrence) => occurrence.status === 'deleted';

/** The zone a meeting was scheduled in, else UTC. */
export function zoneOf(meeting: Meeting): string {
  return meeting.timezone && isValidTimeZone(meeting.timezone) ? meeting.timezone : 'UTC';
}

type Options = {
  /**
   * Whether `meeting` is a single meeting's full details, with its invitees and whole
   * agenda. Listings have neither, so their events leave out `organizer` and `attendees`.
   */
  details: boolean;
};

/** Every occurrence of a series as an event, deleted ones left out. */
export function occurrencesOf(meeting: Meeting, options: Options): EventV1[] {
  return (meeting.occurrences ?? [])
    .filter((occurrence) => !isDeleted(occurrence))
    .map((occurrence) => fromOccurrence(meeting, occurrence, options));
}

/**
 * How long the meetings of a series last. Zoom keeps no length for a series, only for each
 * occurrence, so this is the length most of its occurrences have, the earliest one's on a tie.
 */
export function seriesMinutes(meeting: Meeting): number {
  const durations = (meeting.occurrences ?? []).map((occurrence) => occurrence.duration ?? 0);
  const counts = new Map<number, number>();
  for (const duration of durations) counts.set(duration, (counts.get(duration) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  return durations.find((duration) => counts.get(duration) === most) ?? 0;
}

/** A single meeting, or the master of a series. */
export function fromMeeting(meeting: Meeting, options: Options): EventV1 {
  const timeZone = zoneOf(meeting);
  const base = baseEvent(meeting, options);
  if (meeting.type !== RECURRING) {
    const start = Date.parse(meeting.start_time ?? '');
    return {
      ...base,
      id: String(meeting.id),
      kind: 'single',
      start: time(start, timeZone),
      end: time(start + (meeting.duration ?? 0) * MINUTE, timeZone),
    };
  }
  const occurrences = meeting.occurrences ?? [];
  const starts = occurrences.map(originalStartOf);
  // The series starts with its first meeting, deleted or not. Callers leave out series
  // without occurrences.
  const start = Math.min(...starts);
  const duration = seriesMinutes(meeting) * MINUTE;
  const deleted = occurrences.filter(isDeleted).map(originalStartOf);
  const recurrence = meeting.recurrence && fromZoomRecurrence(meeting.recurrence, deleted);
  return {
    ...base,
    id: String(meeting.id),
    kind: 'series',
    start: time(start, timeZone),
    end: time(start + duration, timeZone),
    // A pattern calsdk cannot read still lists its occurrences.
    recurrence: recurrence ?? formatRdates(starts.map(instantToICalDate)),
  };
}

/** An occurrence of a series: an exception when it was moved or resized on its own. */
export function fromOccurrence(
  meeting: Meeting,
  occurrence: Occurrence,
  options: Options,
): EventV1 {
  const timeZone = zoneOf(meeting);
  const originalStart = originalStartOf(occurrence);
  const start = Date.parse(occurrence.start_time);
  const base = seriesMinutes(meeting);
  const minutes = occurrence.duration ?? base;
  const changed = start !== originalStart || minutes !== base;
  return {
    ...baseEvent(meeting, options, occurrence.occurrence_id),
    id: instanceId(meeting.id, originalStart),
    kind: changed ? 'exception' : 'occurrence',
    seriesId: String(meeting.id),
    originalStart: time(originalStart, timeZone),
    start: time(start, timeZone),
    end: time(start + minutes * MINUTE, timeZone),
  };
}

function baseEvent(meeting: Meeting, { details }: Options, occurrenceId?: string) {
  const metadata: ZoomEventMetadata = {
    uuid: meeting.uuid ?? undefined,
    occurrenceId,
  };
  const host = details && meeting.host_email ? { email: meeting.host_email } : undefined;
  const attendees: AttendeeV1[] | undefined = details
    ? [
        ...(host ? [{ ...host, responseStatus: 'accepted' as const, organizer: true }] : []),
        ...(meeting.settings?.meeting_invitees ?? []).map(
          ({ email }): AttendeeV1 => ({ email, responseStatus: 'needsAction' }),
        ),
      ]
    : undefined;
  return {
    calendarId: 'primary',
    title: meeting.topic || undefined,
    description: meeting.agenda || undefined,
    status: 'confirmed' as const,
    showAs: 'busy' as const,
    organizer: host,
    attendees,
    conference: meeting.join_url
      ? { provider: 'zoom' as const, joinUrl: meeting.join_url, id: String(meeting.id) }
      : undefined,
    createdAt: meeting.created_at ?? undefined,
    providerMetadata: { zoom: metadata },
  };
}

function time(instant: number, timeZone: string): EventTimeV1 {
  return { dateTime: formatZonedDateTime(instant, timeZone), timeZone };
}
