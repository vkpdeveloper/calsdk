import type {
  AttendeeV1,
  ConferenceV1,
  EventTimeV1,
  EventV1,
  PersonV1,
  WarningV1,
} from '@calsdk/provider';
import {
  addDaysToDate,
  eventTimeToInstant,
  formatZonedDateTime,
  isAllDay,
} from '@calsdk/provider-utils';
import ICAL from 'ical.js';
import {
  eventTimeOf,
  instanceKey,
  instantOf,
  type ReadContext,
  type Zone,
  zoneOf,
} from './ical-time';
import { type EventGroup, textOf } from './parse-icalendar';

/**
 * Instances of a series are computed one by one from its start, so a rule running for years
 * (`FREQ=HOURLY`) takes long to expand. Expansion stops after this many.
 */
const MAX_INSTANCES = 50_000;
/**
 * How long one series may be expanded. ical.js searches from DTSTART for times matching the
 * rule, so a sparse rule from long ago can take any amount of work.
 */
const MAX_EXPANSION_MS = 1000;
/**
 * The largest `INTERVAL` expanded. ical.js moves a date one month at a time, so a huge one
 * takes forever to apply. Calendars repeat at most every few years.
 */
const MAX_INTERVAL = 1000;
const DAY_MS = 86_400_000;
/**
 * Read as UTC, a wall-clock time is less than a day from its instant in any zone. Instances
 * further than that from a range are skipped without the costly zone conversion.
 */
const ZONE_SLACK_MS = DAY_MS;

/** The single event or series of a group, when the calendar has it. */
export function masterOf(group: EventGroup, context: ReadContext): EventV1 | undefined {
  return group.master ? masterEvent(group.id, group.master, context) : undefined;
}

/** The single event or series of a group, followed by its exceptions. Cancelled exceptions are deleted instances. */
export function storedEvents(group: EventGroup, context: ReadContext): EventV1[] {
  const master = masterOf(group, context);
  const events = master ? [master] : [];
  for (const exception of group.exceptions) {
    const event = exceptionEvent(group.id, exception, context);
    if (event) events.push(event);
  }
  return events;
}

/** Keys of the instances a series cancels with `STATUS:CANCELLED` exceptions. */
export function cancelledKeys(group: EventGroup, context: ReadContext): string[] {
  return group.exceptions.flatMap((exception) => {
    const key =
      textOf(exception, 'status')?.toUpperCase() === 'CANCELLED' &&
      recurrenceKey(exception, context);
    return key ? [key] : [];
  });
}

/**
 * The instances of a group overlapping `[min, max)`: the single event, the occurrences of
 * the series and its exceptions, unsorted.
 */
export function instancesBetween(
  group: EventGroup,
  context: ReadContext,
  min: number,
  max: number,
  warnings: WarningV1[],
): EventV1[] {
  const overlaps = (event: EventV1) =>
    instant(event.end, context) > min && instant(event.start, context) < max;
  const events: EventV1[] = [];
  if (group.master) {
    const master = masterEvent(group.id, group.master, context);
    if (master.kind === 'single') {
      if (overlaps(master)) events.push(master);
    } else {
      for (const occurrence of occurrences(group, master, context, min, max, warnings)) {
        if (overlaps(occurrence)) events.push(occurrence);
      }
    }
  }
  for (const exception of group.exceptions) {
    const event = exceptionEvent(group.id, exception, context);
    if (event && overlaps(event)) events.push(event);
  }
  return events;
}

/**
 * Finds an event by id: `UID` for single events and series, `UID_<original start>` for
 * their instances.
 */
export function findEvent(
  groups: ReadonlyMap<string, EventGroup>,
  eventId: string,
  context: ReadContext,
  warnings: WarningV1[],
): EventV1 | undefined {
  const group = groups.get(eventId);
  if (group?.master) return masterEvent(group.id, group.master, context);

  const separator = eventId.lastIndexOf('_');
  if (separator <= 0) return undefined;
  const series = groups.get(eventId.slice(0, separator));
  if (!series) return undefined;
  const key = eventId.slice(separator + 1);
  const exception = series.exceptions.find(
    (component) => recurrenceKey(component, context) === key,
  );
  if (exception) return exceptionEvent(series.id, exception, context);
  if (!series.master) return undefined;

  const master = masterEvent(series.id, series.master, context);
  if (master.kind !== 'series') return undefined;
  const target = keyInstant(key);
  if (target === undefined) return undefined;
  // A date key is midnight UTC, within a day of midnight in the calendar's zone.
  const range = occurrences(series, master, context, target - DAY_MS, target + DAY_MS, warnings);
  return range.find((occurrence) => occurrence.id === eventId);
}

/**
 * Unmodified occurrences of a series that may overlap `[min, max)`, without overridden and
 * cancelled ones, unsorted. Callers check the exact overlap.
 *
 * The recurrence set is built here rather than by `ICAL.Event`, which reads every `TZID` it
 * has no registered zone for as UTC: comparing an `EXDATE` or `UNTIL` in UTC with a start in
 * New York would then be off by hours.
 */
function occurrences(
  group: EventGroup,
  series: EventV1,
  context: ReadContext,
  min: number,
  max: number,
  warnings: WarningV1[],
): EventV1[] {
  const master = group.master;
  const startProperty = master?.getFirstProperty('dtstart');
  const startValue = startProperty?.getFirstValue();
  if (!master || !startProperty || !(startValue instanceof ICAL.Time)) return [];
  const zone = zoneOf(startProperty, context);
  const { recurrence: _recurrence, ...fields } = series;
  const length = lengthOf(master, series, context);
  const lengthMs = length.days * DAY_MS + length.ms;

  // Instances already produced, overridden or excluded, by key.
  const skipped = new Set(group.exceptions.map((component) => recurrenceKey(component, context)));
  for (const property of master.getAllProperties('exdate')) {
    const exdateZone = zoneOf(property, context);
    for (const value of property.getValues()) {
      if (value instanceof ICAL.Time) skipped.add(instanceKey(value, exdateZone, context));
    }
  }

  const events: EventV1[] = [];
  const add = (time: ICAL.Time, timeZone: Zone, end?: ICAL.Time | Length | null) => {
    const key = instanceKey(time, timeZone, context);
    if (skipped.has(key)) return;
    skipped.add(key);
    const start = instanceTime(time, timeZone, series.start, context);
    events.push({
      ...fields,
      id: `${group.id}_${key}`,
      kind: 'occurrence',
      seriesId: group.id,
      originalStart: start,
      start,
      end: endOf(time, timeZone, start, end ?? length, context),
    });
  };

  // RDATE periods come first, as a period gives its instance its own length.
  const rdates = master
    .getAllProperties('rdate')
    .flatMap((property) => property.getValues().map((value) => ({ value, property })));
  for (const { value, property } of rdates) {
    if (value instanceof ICAL.Period) {
      const end = value.duration ? durationLength(value.duration) : value.end;
      add(value.start, zoneOf(property, context), end);
    }
  }
  for (const { value, property } of rdates) {
    if (value instanceof ICAL.Time) add(value, zoneOf(property, context));
  }
  // DTSTART is always an instance, whether or not the rule matches it.
  add(startValue, zone);

  for (const property of master.getAllProperties('rrule')) {
    const value = property.getFirstValue();
    if (!(value instanceof ICAL.Recur)) continue;
    // Each instance can take a year of steps to find, too slow to do for every listing.
    if (value.freq === 'SECONDLY' || value.freq === 'MINUTELY') {
      warnings.push({
        type: 'unsupported',
        feature: 'recurrence',
        details: `Series "${group.id}" repeats every ${value.freq === 'SECONDLY' ? 'second' : 'minute'}: only its first instance is listed.`,
      });
      continue;
    }
    if (!Number.isInteger(value.interval) || value.interval < 1 || value.interval > MAX_INTERVAL) {
      warnings.push({
        type: 'unsupported',
        feature: 'recurrence',
        details: `Series "${group.uid}" has an INTERVAL of ${value.interval}: only its first instance is listed.`,
      });
      continue;
    }
    const rule = value.clone();
    // Rules step through wall-clock times, and a UTC UNTIL is an instant: it is compared with
    // each instance's instant below, which also places instances in a repeated hour right.
    let until: number | undefined;
    if (rule.until && !rule.until.isDate && rule.until.zone === ICAL.Timezone.utcTimezone) {
      until = rule.until.toUnixTime() * 1000;
      rule.until = null;
    }
    const outOfTime = () =>
      warnings.push({
        type: 'other',
        message: `Stopped expanding series "${group.uid}" after ${MAX_EXPANSION_MS} ms.`,
      });
    // While starting a monthly rule, ical.js searches for each BYDAY day from the first month
    // again, so one search passing the window says nothing of the others: only time bounds them.
    const searches = rule.freq === 'MONTHLY' ? (rule.parts.BYDAY?.length ?? 0) : 0;
    search = {
      max: searches > 1 ? Number.POSITIVE_INFINITY : max,
      deadline: performance.now() + MAX_EXPANSION_MS,
    };
    let iterator: BoundedIterator | symbol;
    try {
      iterator = bounded(() => new BoundedIterator({ rule, dtstart: startValue }));
      search.max = max;
    } catch (error) {
      // ical.js rejects rules RFC 5545 forbids, such as FREQ=WEEKLY with BYMONTHDAY.
      warnings.push({
        type: 'unsupported',
        feature: 'recurrence',
        details: `Series "${group.uid}" has a rule calsdk cannot expand (${error instanceof Error ? error.message : String(error)}): only its first instance is listed.`,
      });
      continue;
    }
    if (iterator === OUT_OF_TIME) outOfTime();
    if (typeof iterator === 'symbol') continue;
    for (let count = 0; ; count++) {
      const time = bounded(() => iterator.next());
      if (time === OUT_OF_TIME) outOfTime();
      if (typeof time === 'symbol' || !time) break;
      if (until !== undefined && instantOf(time, zone, context) > until) break;
      if (count === MAX_INSTANCES) {
        warnings.push({
          type: 'other',
          message: `Stopped expanding series "${group.id}" after ${MAX_INSTANCES} instances.`,
        });
        break;
      }
      const wallClock = Date.UTC(
        time.year,
        time.month - 1,
        time.day,
        time.hour,
        time.minute,
        time.second,
      );
      if (wallClock - ZONE_SLACK_MS >= max) break;
      if (leftOut(iterator, time)) {
        // Skipped without using up COUNT, which the iterator reads from this same rule.
        if (rule.count) rule.count += 1;
        continue;
      }
      if (wallClock + ZONE_SLACK_MS + lengthMs <= min) continue;
      add(time, zone);
    }
  }
  return events;
}

const PAST_WINDOW = Symbol('past the window');
const OUT_OF_TIME = Symbol('out of time');
/** Where the current expansion may search to, and until when. Expansions run synchronously. */
let search = { max: 0, deadline: 0 };

/**
 * ical.js steps through candidate times until one matches the rule, while starting
 * (`FREQ=MONTHLY;INTERVAL=48;BYDAY=5MO` from a February) and for every instance
 * (`FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30`), forever when no time matches. Each step here stops
 * the search once it passes the window, or the expansion once it runs out of time.
 * Overriding the steps in a subclass also covers the search the constructor runs.
 */
class BoundedIterator extends ICAL.RecurIterator {
  override increment_month() {
    checkpoint(this.last);
    super.increment_month();
  }

  override check_contracting_rules() {
    checkpoint(this.last);
    return super.check_contracting_rules();
  }
}

/**
 * Whether ical.js returned a time of a monthly `BYDAY` rule on a day the rule leaves out. While
 * starting, it picks the first day without applying `BYSETPOS`, so `FREQ=MONTHLY;BYDAY=1MO;
 * BYSETPOS=2` would list a first Monday. And when the first of a month does not match, it still
 * returns the first with the next `BYHOUR` or `BYMINUTE` time. Set positions are counted the way
 * ical.js counts them. `DTSTART` is always an instance.
 */
function leftOut(iterator: ICAL.RecurIterator, time: ICAL.Time) {
  const { rule, dtstart } = iterator;
  if (rule.freq !== 'MONTHLY' || !rule.parts.BYDAY || rule.parts.BYMONTHDAY) return false;
  if (time.compare(dtstart) === 0) return false;
  if (!iterator.is_day_in_byday(time)) return true;
  const positions = rule.parts.BYSETPOS;
  if (!positions) return false;
  const day = time.clone();
  let position = 0;
  let total = 0;
  for (let date = 1; date <= ICAL.Time.daysInMonth(time.month, time.year); date++) {
    day.day = date;
    if (!iterator.is_day_in_byday(day)) continue;
    total++;
    if (date <= time.day) position++;
  }
  return !positions.includes(position) && !positions.includes(position - total - 1);
}

function checkpoint(time: ICAL.Time) {
  const wallClock = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute);
  if (wallClock - ZONE_SLACK_MS >= search.max) throw PAST_WINDOW;
  if (performance.now() > search.deadline) throw OUT_OF_TIME;
}

function bounded<Result>(step: () => Result): Result | typeof PAST_WINDOW | typeof OUT_OF_TIME {
  try {
    return step();
  } catch (error) {
    if (error === PAST_WINDOW || error === OUT_OF_TIME) return error;
    throw error;
  }
}

/** An instance's start or end, shown in the series' zone. */
function instanceTime(
  time: ICAL.Time,
  zone: Zone,
  seriesStart: EventTimeV1,
  context: ReadContext,
): EventTimeV1 {
  if (time.isDate || isAllDay(seriesStart)) return eventTimeOf(time, zone, context);
  const timeZone = seriesStart.timeZone;
  return { dateTime: formatZonedDateTime(instantOf(time, zone, context), timeZone), timeZone };
}

function masterEvent(uid: string, vevent: ICAL.Component, context: ReadContext): EventV1 {
  const recurrence = ['rrule', 'rdate', 'exdate'].flatMap((name) =>
    vevent.getAllProperties(name).map((property) => property.toICALString()),
  );
  const isSeries = vevent.hasProperty('rrule') || vevent.hasProperty('rdate');
  return {
    id: uid,
    calendarId: context.calendarId,
    kind: isSeries ? 'series' : 'single',
    ...timesOf(vevent, context),
    recurrence: isSeries ? recurrence : undefined,
    ...detailsOf(vevent, context),
  };
}

function exceptionEvent(
  uid: string,
  vevent: ICAL.Component,
  context: ReadContext,
): EventV1 | undefined {
  if (textOf(vevent, 'status')?.toUpperCase() === 'CANCELLED') return undefined;
  const property = vevent.getFirstProperty('recurrence-id');
  const value = property?.getFirstValue();
  if (!property || !(value instanceof ICAL.Time)) return undefined;
  return {
    id: `${uid}_${recurrenceKey(vevent, context)}`,
    calendarId: context.calendarId,
    kind: 'exception',
    seriesId: uid,
    originalStart: eventTimeOf(value, zoneOf(property, context), context),
    ...timesOf(vevent, context),
    ...detailsOf(vevent, context),
  };
}

/** The id suffix of an exception, from its `RECURRENCE-ID`. */
export function recurrenceKey(vevent: ICAL.Component, context: ReadContext): string | undefined {
  const property = vevent.getFirstProperty('recurrence-id');
  const value = property?.getFirstValue();
  if (!property || !(value instanceof ICAL.Time)) return undefined;
  return instanceKey(value, zoneOf(property, context), context);
}

/** `DTEND`, else `DTSTART` plus `DURATION`, else the default of RFC 5545: one day for dates, none for date-times. */
function timesOf(vevent: ICAL.Component, context: ReadContext): Pick<EventV1, 'start' | 'end'> {
  const startProperty = vevent.getFirstProperty('dtstart');
  const startValue = startProperty?.getFirstValue();
  if (!startProperty || !(startValue instanceof ICAL.Time)) {
    throw new Error('Events read for their times always have a DTSTART.');
  }
  const start = eventTimeOf(startValue, zoneOf(startProperty, context), context);

  let end: EventTimeV1 | undefined;
  const endProperty = endPropertyOf(vevent, startValue);
  const duration = vevent.getFirstPropertyValue('duration');
  if (endProperty) {
    end = eventTimeOf(endProperty.value, zoneOf(endProperty.property, context), context);
  } else if (duration instanceof ICAL.Duration) {
    end = endOf(
      startValue,
      zoneOf(startProperty, context),
      start,
      durationLength(duration),
      context,
    );
  }
  if (!end || instant(end, context) < instant(start, context)) {
    end = isAllDay(start) ? { date: addDaysToDate(start.date, 1) } : start;
  }
  return { start, end };
}

function endPropertyOf(vevent: ICAL.Component, startValue: ICAL.Time) {
  const property = vevent.getFirstProperty('dtend');
  const value = property?.getFirstValue();
  return property && value instanceof ICAL.Time && value.isDate === startValue.isDate
    ? { property, value }
    : undefined;
}

/** Calendar days, then elapsed time: a day is 23 or 25 hours long when the clocks change. */
type Length = { days: number; ms: number };

/**
 * How long each instance of a series lasts. RFC 5545 gives every instance the exact length of
 * the first one, except that the days of a `DURATION` are calendar days.
 */
function lengthOf(vevent: ICAL.Component, event: EventV1, context: ReadContext): Length {
  const startValue = vevent.getFirstPropertyValue('dtstart');
  const duration = vevent.getFirstPropertyValue('duration');
  if (
    startValue instanceof ICAL.Time &&
    !endPropertyOf(vevent, startValue) &&
    duration instanceof ICAL.Duration
  ) {
    return durationLength(duration);
  }
  if (isAllDay(event.start) && isAllDay(event.end)) {
    return {
      days: Math.round((Date.parse(event.end.date) - Date.parse(event.start.date)) / DAY_MS),
      ms: 0,
    };
  }
  return { days: 0, ms: instant(event.end, context) - instant(event.start, context) };
}

function durationLength(duration: ICAL.Duration): Length {
  const sign = duration.isNegative ? -1 : 1;
  return {
    days: sign * (duration.weeks * 7 + duration.days),
    ms: sign * (duration.hours * 3600 + duration.minutes * 60 + duration.seconds) * 1000,
  };
}

/**
 * The end of an instance starting at `time` in `zone`: `end` itself, or `start` plus a length.
 * The days of a length are counted in `zone`, the instance's own, not the one it is shown in.
 */
function endOf(
  time: ICAL.Time,
  zone: Zone,
  start: EventTimeV1,
  end: ICAL.Time | Length,
  context: ReadContext,
): EventTimeV1 {
  if (end instanceof ICAL.Time) return instanceTime(end, zone, start, context);
  if (isAllDay(start)) return { date: addDaysToDate(start.date, end.days) };
  const shifted = time.clone();
  shifted.adjust(end.days, 0, 0, 0);
  const instant = instantOf(shifted, zone, context) + end.ms;
  return { dateTime: formatZonedDateTime(instant, start.timeZone), timeZone: start.timeZone };
}

const instant = (time: EventTimeV1, context: ReadContext) =>
  eventTimeToInstant(time, context.timeZone);

/** The instant of an id suffix: `20261103T100000Z` or `20261103`. */
function keyInstant(key: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(key);
  if (!match) return undefined;
  const part = (index: number) => Number(match[index] ?? 0);
  return Date.UTC(part(1), part(2) - 1, part(3), part(4), part(5), part(6));
}

function detailsOf(vevent: ICAL.Component, context: ReadContext) {
  const organizer = personOf(vevent.getFirstProperty('organizer'));
  const attendees = vevent.getAllProperties('attendee').flatMap((property): AttendeeV1[] => {
    const person = personOf(property);
    if (!person) return [];
    const role = String(property.getParameter('role') ?? '').toUpperCase();
    return [
      {
        ...person,
        responseStatus:
          RESPONSE_STATUS[String(property.getParameter('partstat') ?? '').toUpperCase()] ??
          'needsAction',
        optional: role === 'OPT-PARTICIPANT' || role === 'NON-PARTICIPANT' ? true : undefined,
        organizer: organizer && sameEmail(person.email, organizer.email) ? true : undefined,
      },
    ];
  });
  const url = textOf(vevent, 'url');
  return {
    title: textOf(vevent, 'summary'),
    description: textOf(vevent, 'description'),
    location: textOf(vevent, 'location'),
    status: STATUS[textOf(vevent, 'status')?.toUpperCase() ?? ''] ?? 'confirmed',
    showAs: textOf(vevent, 'transp')?.toUpperCase() === 'TRANSPARENT' ? 'free' : 'busy',
    visibility: VISIBILITY[textOf(vevent, 'class')?.toUpperCase() ?? ''],
    organizer,
    attendees: attendees.length > 0 ? attendees : undefined,
    conference: conferenceOf(vevent),
    htmlLink: url?.startsWith('https://') ? url : undefined,
    createdAt: timestampOf(vevent, 'created', context),
    updatedAt: timestampOf(vevent, 'last-modified', context),
  } satisfies Partial<EventV1>;
}

const STATUS: Record<string, EventV1['status']> = {
  CONFIRMED: 'confirmed',
  TENTATIVE: 'tentative',
  CANCELLED: 'cancelled',
};
const VISIBILITY: Record<string, EventV1['visibility']> = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  CONFIDENTIAL: 'private',
};
const RESPONSE_STATUS: Record<string, AttendeeV1['responseStatus']> = {
  'NEEDS-ACTION': 'needsAction',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
};

/** A `mailto:` organizer or attendee. Others, such as rooms addressed by URN, have no email. */
function personOf(property: ICAL.Property | null): PersonV1 | undefined {
  const value = property?.getFirstValue();
  if (!property || typeof value !== 'string' || !/^mailto:/i.test(value)) return undefined;
  const email = value.slice('mailto:'.length).trim();
  if (!email) return undefined;
  const name = property.getParameter('cn');
  return { email, name: typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined };
}

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const MEETING_LINKS: [RegExp, ConferenceV1['provider']][] = [
  [/^https:\/\/meet\.google\.com\//i, 'google-meet'],
  [/^https:\/\/teams\.(microsoft|live)\.com\//i, 'teams'],
  [/^https:\/\/([a-z0-9-]+\.)*zoom\.us\//i, 'zoom'],
];

/** The first Meet, Teams or Zoom link in the conference, URL, location or description. */
function conferenceOf(vevent: ICAL.Component): ConferenceV1 | undefined {
  for (const name of ['x-google-conference', 'url', 'location', 'description']) {
    for (const link of textOf(vevent, name)?.match(/https:\/\/[^\s<>"']+/g) ?? []) {
      const match = MEETING_LINKS.find(([pattern]) => pattern.test(link));
      if (match) return { provider: match[1], joinUrl: link };
    }
  }
  return undefined;
}

function timestampOf(
  vevent: ICAL.Component,
  name: string,
  context: ReadContext,
): string | undefined {
  const property = vevent.getFirstProperty(name);
  const value = property?.getFirstValue();
  if (!property || !(value instanceof ICAL.Time)) return undefined;
  const zone: Zone = zoneOf(property, context);
  return new Date(instantOf(value, zone, context)).toISOString();
}
