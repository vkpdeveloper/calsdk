import { ianaToWindowsZones, windowsToIanaZones } from './windows-zones';

/** A wall-clock date and time with no zone attached. `month` is 1-12. */
export type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond?: number;
};

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether the runtime knows this IANA time zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Maps a Windows time zone name (`'India Standard Time'`) to IANA (`'Asia/Kolkata'`). */
export function windowsToIana(windowsTimeZone: string): string | undefined {
  return Object.hasOwn(windowsToIanaZones, windowsTimeZone)
    ? windowsToIanaZones[windowsTimeZone]
    : undefined;
}

/** Maps an IANA time zone (`'Asia/Kolkata'`) to its Windows name (`'India Standard Time'`). */
export function ianaToWindows(timeZone: string): string | undefined {
  return Object.hasOwn(ianaToWindowsZones, timeZone) ? ianaToWindowsZones[timeZone] : undefined;
}

/** Epoch milliseconds of `local` read as UTC. Unlike `Date.UTC`, years 0-99 are not shifted to 19xx. */
function localAsUTC(local: LocalDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(local.year, local.month - 1, local.day);
  date.setUTCHours(local.hour, local.minute, local.second, local.millisecond ?? 0);
  return date.getTime();
}

/** The wall-clock time in `timeZone` at `instant` (epoch milliseconds). */
export function instantToLocal(instant: number, timeZone: string): LocalDateTime {
  const millisecond = ((instant % 1000) + 1000) % 1000;
  const local: LocalDateTime = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond,
  };
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type in local) local[part.type as keyof LocalDateTime] = Number(part.value);
  }
  return local;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (`+05:30` is `19_800_000`). */
export function getTimeZoneOffset(instant: number, timeZone: string): number {
  return localAsUTC(instantToLocal(instant, timeZone)) - instant;
}

/**
 * The instant at which the wall clock in `timeZone` shows `local`.
 *
 * Follows RFC 5545 for daylight saving transitions: a time that occurs twice
 * resolves to the earlier instant, and a time skipped by a gap moves forward
 * by the length of the gap (02:30 on a spring-forward day becomes 03:30).
 */
export function localToInstant(local: LocalDateTime, timeZone: string): number {
  const asUTC = localAsUTC(local);
  const offsetBefore = getTimeZoneOffset(asUTC - DAY_MS, timeZone);
  const offsetAfter = getTimeZoneOffset(asUTC + DAY_MS, timeZone);

  const matches = [offsetBefore, offsetAfter]
    .map((offset) => asUTC - offset)
    .filter((instant) => getTimeZoneOffset(instant, timeZone) === asUTC - instant);
  if (matches.length > 0) return Math.min(...matches);

  return asUTC - offsetBefore;
}

/** Parses `'YYYY-MM-DD'` or `'YYYY-MM-DDTHH:mm[:ss[.fff...]]'` with no offset. */
export function parseLocalDateTime(value: string): LocalDateTime | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/.exec(
    value,
  );
  if (!match) return undefined;
  const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = ''] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    // Millisecond precision; extra digits are truncated.
    millisecond: Number(fraction.slice(0, 3).padEnd(3, '0')),
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** `'YYYY-MM-DD'`. */
export function formatLocalDate(local: Pick<LocalDateTime, 'year' | 'month' | 'day'>): string {
  return `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`;
}

/** `'YYYY-MM-DDTHH:mm:ss[.sss]'`, no offset. Milliseconds are only written when non-zero. */
export function formatLocalDateTime(local: LocalDateTime): string {
  const time = `${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}`;
  const fraction = local.millisecond ? `.${pad(local.millisecond, 3)}` : '';
  return `${formatLocalDate(local)}T${time}${fraction}`;
}

/**
 * ISO 8601 with the zone's offset at that instant, e.g. `'2026-11-03T10:00:00+05:30'`.
 * Historical offsets with seconds (local mean time before ~1900) cannot be written as
 * `+HH:mm`, so those instants are written in UTC instead.
 */
export function formatZonedDateTime(instant: number, timeZone: string): string {
  if (getTimeZoneOffset(instant, timeZone) % 60_000 !== 0) {
    return formatZonedDateTime(instant, 'UTC');
  }
  const offsetMinutes = getTimeZoneOffset(instant, timeZone) / 60_000;
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `${formatLocalDateTime(instantToLocal(instant, timeZone))}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
