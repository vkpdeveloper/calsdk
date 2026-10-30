import { type EventTimeV1, InvalidResponseDataError } from '@calsdk/provider';
import {
  formatLocalDate,
  formatLocalDateTime,
  formatZonedDateTime,
  instantToLocal,
  isAllDay,
  isValidTimeZone,
  localToInstant,
  parseLocalDateTime,
  windowsToIana,
} from '@calsdk/provider-utils';
import type { GraphTime } from './microsoft-api';

/**
 * The IANA zone for a Graph zone name. Graph returns Windows names (`'Eastern Standard
 * Time'`) for most events and IANA names for some.
 */
export function fromGraphZone(zone: string | null | undefined): string | undefined {
  if (!zone) return undefined;
  if (zone === 'tzone://Microsoft/Utc') return 'UTC';
  return windowsToIana(zone) ?? (isValidTimeZone(zone) ? zone : undefined);
}

/** Epoch milliseconds of a Graph time. Without a known zone the value is UTC, as requested. */
export function graphTimeToInstant(time: GraphTime | undefined): number {
  const local = time && parseLocalDateTime(time.dateTime);
  if (!local) {
    throw new InvalidResponseDataError({
      data: time,
      message: 'Microsoft Graph returned an event time without a valid dateTime.',
    });
  }
  return localToInstant(local, fromGraphZone(time?.timeZone) ?? 'UTC');
}

/** An instant as an event time in `zone`: the local date for all-day events. */
export function instantToEventTime(instant: number, zone: string, allDay: boolean): EventTimeV1 {
  if (allDay) return { date: formatLocalDate(instantToLocal(instant, zone)) };
  return { dateTime: formatZonedDateTime(instant, zone), timeZone: zone };
}

/**
 * A Graph time for writing. Timed values are sent as wall-clock time in their own zone, so
 * Outlook shows the zone the event was scheduled in. All-day values are midnight UTC.
 */
export function toGraphTime(time: EventTimeV1): GraphTime {
  if (isAllDay(time)) return { dateTime: `${time.date}T00:00:00`, timeZone: 'UTC' };
  const { millisecond: _, ...local } = instantToLocal(Date.parse(time.dateTime), time.timeZone);
  return { dateTime: formatLocalDateTime(local), timeZone: time.timeZone };
}
