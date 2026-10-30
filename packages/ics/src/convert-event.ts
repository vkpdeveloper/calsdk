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
 * Instances of a series are computed one by one from its start. Rules such as
 * `FREQ=MINUTELY` running for years would take very long, so expansion stops here.
 */
const MAX_INSTANCES = 50_000;
const DAY_MS = 86_400_000;
/**
 * Read as UTC, a wall-clock time is less than a day from its instant in any zone. Instances
 * further than that from a range are skipped without the costly zone conversion.
 */
const ZONE_SLACK_MS = DAY_MS;

/** The single event or series of a group, when the calendar has it. */
export function masterOf(group: EventGroup, context: ReadContext): EventV1 | undefined {
  return group.master ? masterEvent(group.uid, group.master, context) : undefined;
}

/** The single event or series of a group, followed by its exceptions. Cancelled exceptions are deleted instances. */
export function storedEvents(group: EventGroup, context: ReadContext): EventV1[] {
  const master = masterOf(group, context);
  const events = master ? [master] : [];
  for (const exception of group.exceptions) {
    const event = exceptionEvent(group.uid, exception, context);
    if (event) events.push(event);
  }
  return events;
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
    const master = masterEvent(group.uid, group.master, context);
    if (master.kind === 'single') {
      if (overlaps(master)) events.push(master);
    } else {
      for (const occurrence of occurrences(group, master, context, min, max, warnings)) {
        if (overlaps(occurrence)) events.push(occurrence);
      }
    }
  }
  for (const exception of group.exceptions) {
    const event = exceptionEvent(group.uid, exception, context);
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
  if (group?.master) return masterEvent(group.uid, group.master, context);

  const separator = eventId.lastIndexOf('_');
  if (separator <= 0) return undefined;
  const series = groups.get(eventId.slice(0, separator));
  if (!series) return undefined;
  const key = eventId.slice(separator + 1);
  const exception = series.exceptions.find(
    (component) => recurrenceKey(component, context) === key,
  );
  if (exception) return exceptionEvent(series.uid, exception, context);
  if (!series.master) return undefined;

  const master = masterEvent(series.uid, series.master, context);
  if (master.kind !== 'series') return undefined;
  const target = keyInstant(key);
  if (target === undefined) return undefined;
  // A date key is midnight UTC, within a day of midnight in the calendar's zone.
  const range = occurrences(series, master, context, target - DAY_MS, target + DAY_MS, warnings);
  return range.find((occurrence) => occurrence.id === eventId);
}

/**
 * Unmodified occurrences of a series that may overlap `[min, max)`, in start order, without
 * overridden and cancelled ones. Callers check the exact overlap.
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
  if (!master || !startProperty) return [];
  const zone = zoneOf(startProperty, context);
  const overridden = new Set(
    group.exceptions.map((component) => recurrenceKey(component, context)),
  );
  const { recurrence: _recurrence, ...fields } = series;
  const length = lengthOf(series, context);
  const lengthMs = 'ms' in length ? length.ms : length.days * DAY_MS;

  const events: EventV1[] = [];
  const iterator = new ICAL.Event(master).iterator();
  for (let count = 0; ; count++) {
    const time = iterator.next();
    if (!time) return events;
    if (count === MAX_INSTANCES) {
      warnings.push({
        type: 'other',
        message: `Stopped expanding series "${group.uid}" after ${MAX_INSTANCES} instances.`,
      });
      return events;
    }
    const wallClock = Date.UTC(
      time.year,
      time.month - 1,
      time.day,
      time.hour,
      time.minute,
      time.second,
    );
    if (wallClock - ZONE_SLACK_MS >= max) return events;
    if (wallClock + ZONE_SLACK_MS + lengthMs <= min) continue;

    const key = instanceKey(time, zone, context);
    if (overridden.has(key)) continue;
    const start = eventTimeOf(time, zone, context);
    events.push({
      ...fields,
      id: `${group.uid}_${key}`,
      kind: 'occurrence',
      seriesId: group.uid,
      originalStart: start,
      start,
      end: shift(start, length, context),
    });
  }
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

function recurrenceKey(vevent: ICAL.Component, context: ReadContext): string | undefined {
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
    throw new Error('Grouped events always have a DTSTART.');
  }
  const startZone = zoneOf(startProperty, context);
  const start = eventTimeOf(startValue, startZone, context);

  let end: EventTimeV1 | undefined;
  const endProperty = vevent.getFirstProperty('dtend');
  const endValue = endProperty?.getFirstValue();
  const duration = vevent.getFirstPropertyValue('duration');
  if (endProperty && endValue instanceof ICAL.Time && endValue.isDate === startValue.isDate) {
    end = eventTimeOf(endValue, zoneOf(endProperty, context), context);
  } else if (duration instanceof ICAL.Duration) {
    const endTime = startValue.clone();
    endTime.addDuration(duration);
    end = eventTimeOf(endTime, startZone, context);
  }
  if (!end || instant(end, context) < instant(start, context)) {
    end = isAllDay(start) ? { date: addDaysToDate(start.date, 1) } : start;
  }
  return { start, end };
}

type Length = { days: number } | { ms: number };

function lengthOf(event: EventV1, context: ReadContext): Length {
  if (isAllDay(event.start) && isAllDay(event.end)) {
    return {
      days: Math.round((Date.parse(event.end.date) - Date.parse(event.start.date)) / 86_400_000),
    };
  }
  return { ms: instant(event.end, context) - instant(event.start, context) };
}

// RFC 5545 gives every instance the exact length of the series' first one.
function shift(start: EventTimeV1, length: Length, context: ReadContext): EventTimeV1 {
  if (isAllDay(start))
    return { date: addDaysToDate(start.date, 'days' in length ? length.days : 1) };
  const end = instant(start, context) + ('ms' in length ? length.ms : 0);
  return { dateTime: formatZonedDateTime(end, start.timeZone), timeZone: start.timeZone };
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
