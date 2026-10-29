import type { EventTimeV1 } from '@calsdk/provider';
import { formatLocalDate, localToInstant, parseLocalDateTime } from './zoned-time';

/** Narrows an event time to the all-day form. */
export function isAllDay(time: EventTimeV1): time is { date: string } {
  return 'date' in time;
}

/**
 * The instant an event time refers to, in epoch milliseconds.
 *
 * All-day dates have no instant of their own: they start at midnight in
 * `allDayTimeZone` (usually the calendar's zone), UTC when omitted.
 */
export function eventTimeToInstant(time: EventTimeV1, allDayTimeZone = 'UTC'): number {
  if (!isAllDay(time)) return Date.parse(time.dateTime);
  const local = parseLocalDateTime(time.date);
  if (!local) return Number.NaN;
  return localToInstant(local, allDayTimeZone);
}

/** Adds whole days to a `'YYYY-MM-DD'` date. */
export function addDaysToDate(date: string, days: number): string {
  const local = parseLocalDateTime(date);
  if (!local) throw new RangeError(`Invalid date "${date}", expected YYYY-MM-DD.`);
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return formatLocalDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}
