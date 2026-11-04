import { type ReadContext, wallClockOf, type Zone, zoneOf } from '@calsdk/ics/icalendar';
import {
  type EventInputV1,
  type EventPatchV1,
  type EventTimeV1,
  InvalidArgumentError,
  type SendUpdatesV1,
  type WarningV1,
} from '@calsdk/provider';
import {
  instantToLocal,
  isAllDay,
  type LocalDateTime,
  parseRecurrence,
} from '@calsdk/provider-utils';
import ICAL from 'ical.js';

const PRODID = '-//calsdk//CalDAV//EN';
const RECURRENCE = ['rrule', 'rdate', 'exdate', 'exrule'];

export type WriteOptions = {
  /** The account's email, the organizer of events with attendees. */
  organizer?: string;
  warnings: WarningV1[];
};

/** A `VCALENDAR` holding one new `VEVENT`. */
export function newCalendar(uid: string, input: EventInputV1, options: WriteOptions) {
  const calendar = new ICAL.Component('vcalendar');
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', PRODID);
  const vevent = new ICAL.Component('vevent');
  vevent.updatePropertyWithValue('uid', uid);
  vevent.updatePropertyWithValue('created', now());
  vevent.updatePropertyWithValue('sequence', 0);
  calendar.addSubcomponent(vevent);
  applyPatch(vevent, input, options);
  touch(vevent);
  return calendar;
}

/** Writes the fields a patch sets into a `VEVENT`. `null` removes the property. */
export function applyPatch(vevent: ICAL.Component, patch: EventPatchV1, options: WriteOptions) {
  setText(vevent, 'summary', patch.title);
  setText(vevent, 'description', patch.description);
  setText(vevent, 'location', patch.location);
  if (patch.start) setTime(vevent, 'dtstart', patch.start);
  if (patch.end) {
    vevent.removeAllProperties('duration');
    setTime(vevent, 'dtend', patch.end);
  }
  if (patch.recurrence !== undefined) setRecurrence(vevent, patch.recurrence ?? []);
  if (patch.showAs !== undefined) {
    vevent.updatePropertyWithValue('transp', patch.showAs === 'free' ? 'TRANSPARENT' : 'OPAQUE');
  }
  if (patch.visibility !== undefined) {
    vevent.removeAllProperties('class');
    if (patch.visibility === 'public' || patch.visibility === 'private') {
      vevent.updatePropertyWithValue('class', patch.visibility.toUpperCase());
    }
  }
  if (patch.attendees !== undefined) setAttendees(vevent, patch.attendees ?? [], options);

  const ignored: [keyof EventPatchV1, boolean][] = [
    ['createConference', patch.createConference === true],
    ['reminders', patch.reminders !== undefined],
    ['color', patch.color !== undefined],
  ];
  for (const [feature, set] of ignored) {
    if (set) {
      options.warnings.push({
        type: 'unsupported',
        feature,
        details: 'The CalDAV provider does not write this field.',
      });
    }
  }
}

/** Marks a changed `VEVENT`, so other clients and invitees see the new version. */
export function touch(vevent: ICAL.Component, changed = false) {
  const stamp = now();
  vevent.updatePropertyWithValue('dtstamp', stamp);
  vevent.updatePropertyWithValue('last-modified', stamp);
  if (changed) {
    const sequence = vevent.getFirstPropertyValue('sequence');
    vevent.updatePropertyWithValue('sequence', (typeof sequence === 'number' ? sequence : 0) + 1);
  }
}

/**
 * Who sends invitations, for servers that schedule (RFC 6638): the server by default, nobody
 * for `sendUpdates: 'none'`, as `SCHEDULE-AGENT=CLIENT` leaves it to a client that never does.
 */
export function setScheduleAgent(
  calendar: ICAL.Component,
  sendUpdates: SendUpdatesV1 | undefined,
  warnings: WarningV1[],
) {
  if (sendUpdates === 'externalOnly') {
    warnings.push({
      type: 'unsupported',
      feature: 'sendUpdates',
      details: 'CalDAV servers notify every attendee or none, so all are notified.',
    });
  }
  for (const vevent of calendar.getAllSubcomponents('vevent')) {
    for (const attendee of vevent.getAllProperties('attendee')) {
      if (sendUpdates === 'none') attendee.setParameter('schedule-agent', 'CLIENT');
      else attendee.removeParameter('schedule-agent');
    }
  }
}

/**
 * A new exception for one occurrence of `master`: a copy without the recurrence, identified
 * by `recurrenceId`.
 */
export function newException(master: ICAL.Component, recurrenceId: ICAL.Property) {
  const exception = ICAL.Component.fromString(master.toString());
  for (const name of [...RECURRENCE, 'recurrence-id']) exception.removeAllProperties(name);
  exception.addProperty(recurrenceId);
  return exception;
}

/**
 * A `RECURRENCE-ID` or `EXDATE` naming the occurrence of `master` that started at
 * `originalStart`. It is written like the `DTSTART`, in the same zone, as servers and clients
 * match the two by value.
 */
export function instanceProperty(
  name: 'recurrence-id' | 'exdate',
  master: ICAL.Component,
  originalStart: EventTimeV1,
  context: ReadContext,
): ICAL.Property {
  const property = new ICAL.Property(name);
  if (isAllDay(originalStart)) {
    property.setValue(ICAL.Time.fromDateString(originalStart.date));
    return property;
  }
  const dtstart = master.getFirstProperty('dtstart');
  const zone: Zone = dtstart ? zoneOf(dtstart, context) : { type: 'utc' };
  const tzid = dtstart?.getParameter('tzid');
  if (typeof tzid === 'string' && zone.type !== 'utc') property.setParameter('tzid', tzid);
  const value = wallClockOf(Date.parse(originalStart.dateTime), zone, context);
  if (zone.type === 'utc') value.zone = ICAL.Timezone.utcTimezone;
  property.setValue(value);
  return property;
}

const timeData = ({ year, month, day, hour, minute, second }: LocalDateTime) => ({
  year,
  month,
  day,
  hour,
  minute,
  second,
  isDate: false,
});

function setText(vevent: ICAL.Component, name: string, value: string | null | undefined) {
  if (value === undefined) return;
  if (value === null || value === '') vevent.removeAllProperties(name);
  else vevent.updatePropertyWithValue(name, value);
}

/**
 * Writes a time in the zone it was given in, as `TZID=<IANA name>`. Clients and servers
 * read those names from their own zone data.
 */
export function setTime(vevent: ICAL.Component, name: 'dtstart' | 'dtend', time: EventTimeV1) {
  vevent.removeAllProperties(name);
  const property = new ICAL.Property(name);
  if (isAllDay(time)) {
    property.setValue(ICAL.Time.fromDateString(time.date));
  } else {
    property.setParameter('tzid', time.timeZone);
    property.setValue(
      ICAL.Time.fromData(timeData(instantToLocal(Date.parse(time.dateTime), time.timeZone))),
    );
  }
  vevent.addProperty(property);
}

function setRecurrence(vevent: ICAL.Component, lines: string[]) {
  // Checks the RRULE, and that every line is a single line.
  parseRecurrence(lines);
  const properties = lines.map((line) => {
    let property: ICAL.Property;
    try {
      property = ICAL.Property.fromString(line);
    } catch (error) {
      throw new InvalidArgumentError({
        argument: 'recurrence',
        message: `"${line}" is not an iCalendar property.`,
        cause: error,
      });
    }
    if (!RECURRENCE.includes(property.name)) {
      throw new InvalidArgumentError({
        argument: 'recurrence',
        message: `"${line}" is not an RRULE, RDATE, EXDATE or EXRULE line.`,
      });
    }
    return property;
  });
  for (const name of RECURRENCE) vevent.removeAllProperties(name);
  for (const property of properties) vevent.addProperty(property);
}

function setAttendees(
  vevent: ICAL.Component,
  attendees: NonNullable<EventInputV1['attendees']>,
  options: WriteOptions,
) {
  // Responses already given stay when the list is written again.
  const previous = new Map<string, ICAL.Property>();
  for (const property of vevent.getAllProperties('attendee')) {
    const email = emailOf(property);
    if (email) previous.set(email.toLowerCase(), property);
  }
  vevent.removeAllProperties('attendee');
  if (attendees.length === 0) return;

  if (!vevent.hasProperty('organizer')) {
    if (!options.organizer) {
      throw new InvalidArgumentError({
        argument: 'attendees',
        message:
          'The CalDAV server reports no email address for this account, so it cannot invite attendees.',
      });
    }
    vevent.updatePropertyWithValue('organizer', `mailto:${options.organizer}`);
  }
  for (const attendee of attendees) {
    const property = new ICAL.Property('attendee');
    property.setValue(`mailto:${attendee.email}`);
    if (attendee.name) property.setParameter('cn', attendee.name);
    property.setParameter('role', attendee.optional ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT');
    const partstat = previous.get(attendee.email.toLowerCase())?.getParameter('partstat');
    property.setParameter('partstat', typeof partstat === 'string' ? partstat : 'NEEDS-ACTION');
    if (typeof partstat !== 'string') property.setParameter('rsvp', 'TRUE');
    vevent.addProperty(property);
  }
}

function emailOf(property: ICAL.Property): string | undefined {
  const value = property.getFirstValue();
  return typeof value === 'string' && /^mailto:/i.test(value)
    ? value.slice('mailto:'.length).trim()
    : undefined;
}

const now = () => ICAL.Time.fromJSDate(new Date(), true);
