import type { EventTimeV1 } from '@calsdk/provider';
import {
  formatICalDate,
  formatLocalDate,
  formatZonedDateTime,
  getTimeZoneOffset,
  instantToICalDate,
  instantToLocal,
  isValidTimeZone,
  localToInstant,
  windowsToIana,
} from '@calsdk/provider-utils';
import ICAL from 'ical.js';

/**
 * How the wall-clock values of a date-time property map to instants. ical.js only knows
 * zones registered in its global `TimezoneService`, which would mix the definitions of
 * different calendars, so calsdk resolves zones itself.
 */
export type Zone =
  | { type: 'utc' }
  | { type: 'iana'; name: string }
  /** A zone defined only by a `VTIMEZONE` of the calendar, such as Outlook's custom zones. */
  | { type: 'custom'; timezone: ICAL.Timezone }
  /** No zone, or one nobody can resolve: the calendar's zone applies. */
  | { type: 'floating' };

export type ReadContext = {
  calendarId: string;
  /** IANA zone for floating times, UTC times and the bounds of all-day dates. */
  timeZone: string;
  /** `VTIMEZONE` definitions of the calendar, by `TZID`. */
  timezones: ReadonlyMap<string, ICAL.Timezone>;
};

/** The zone of a `DTSTART`, `DTEND`, `RECURRENCE-ID`, `RDATE` or `EXDATE` property. */
export function zoneOf(property: ICAL.Property, context: ReadContext): Zone {
  const first = property.getFirstValue();
  // A PERIOD (in an RDATE) is in the zone of its start.
  const value = first instanceof ICAL.Period ? first.start : first;
  if (value instanceof ICAL.Time && value.zone === ICAL.Timezone.utcTimezone)
    return { type: 'utc' };
  const tzid = property.getParameter('tzid');
  if (typeof tzid !== 'string') return { type: 'floating' };
  // IANA data in the runtime is more current than a VTIMEZONE copied into the file.
  const name = ianaName(tzid);
  if (name) return { type: 'iana', name };
  const timezone = context.timezones.get(tzid);
  return timezone ? { type: 'custom', timezone } : { type: 'floating' };
}

/** An IANA name, a Windows name (Outlook), or a path ending in one (`/mozilla.org/.../Europe/Berlin`). */
function ianaName(tzid: string): string | undefined {
  if (isValidTimeZone(tzid)) return tzid;
  const windows = windowsToIana(tzid);
  if (windows) return windows;
  const parts = tzid.split('/');
  for (let index = 1; index < parts.length - 1; index++) {
    const candidate = parts.slice(index).join('/');
    if (isValidTimeZone(candidate)) return candidate;
  }
  return undefined;
}

/** The instant of a date-time, or of midnight in the calendar's zone for a date. */
export function instantOf(time: ICAL.Time, zone: Zone, context: ReadContext): number {
  const local = {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.isDate ? 0 : time.hour,
    minute: time.isDate ? 0 : time.minute,
    second: time.isDate ? 0 : time.second,
  };
  if (time.isDate) return localToInstant(local, context.timeZone);
  const wallClock = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  switch (zone.type) {
    case 'utc':
      return wallClock;
    case 'iana':
      return localToInstant(local, zone.name);
    case 'custom':
      return wallClock - zone.timezone.utcOffset(time) * 1000;
    case 'floating':
      return localToInstant(local, context.timeZone);
  }
}

/** The wall-clock time `instant` has in `zone`, as a time without a zone. */
export function wallClockOf(instant: number, zone: Zone, context: ReadContext): ICAL.Time {
  const timeAt = (at: number) => {
    const { year, month, day, hour, minute, second } = instantToLocal(at, 'UTC');
    return ICAL.Time.fromData({ year, month, day, hour, minute, second, isDate: false });
  };
  switch (zone.type) {
    case 'utc':
      return timeAt(instant);
    case 'iana':
      return timeAt(instant + getTimeZoneOffset(instant, zone.name));
    case 'floating':
      return timeAt(instant + getTimeZoneOffset(instant, context.timeZone));
    case 'custom': {
      // A VTIMEZONE gives offsets by wall-clock time, so the wall clock is found by refining a guess.
      let local = timeAt(instant);
      for (let step = 0; step < 2; step++) {
        local = timeAt(instant + zone.timezone.utcOffset(local) * 1000);
      }
      return local;
    }
  }
}

export function eventTimeOf(time: ICAL.Time, zone: Zone, context: ReadContext): EventTimeV1 {
  if (time.isDate) return { date: formatLocalDate(time) };
  const timeZone = zone.type === 'iana' ? zone.name : context.timeZone;
  return { dateTime: formatZonedDateTime(instantOf(time, zone, context), timeZone), timeZone };
}

/**
 * The id suffix of an instance of a series: its original start as a UTC date-time
 * (`20261103T100000Z`), or its date for all-day series (`20261103`), like Google's.
 */
export function instanceKey(time: ICAL.Time, zone: Zone, context: ReadContext): string {
  return time.isDate
    ? formatICalDate({ type: 'date', date: formatLocalDate(time) })
    : formatICalDate(instantToICalDate(instantOf(time, zone, context)));
}
