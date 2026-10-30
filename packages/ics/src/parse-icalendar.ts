import { InvalidResponseDataError } from '@calsdk/provider';
import { isValidTimeZone } from '@calsdk/provider-utils';
import ICAL from 'ical.js';
import type { ReadContext } from './ical-time';

/** A series or single event with the instances that override it, all sharing one `UID`. */
export type EventGroup = {
  uid: string;
  /** Missing when only overridden instances were shared, as in some invitations. */
  master?: ICAL.Component;
  /** `VEVENT`s with a `RECURRENCE-ID`. */
  exceptions: ICAL.Component[];
};

export type ParsedICalendar = {
  /** `X-WR-CALNAME`. */
  name?: string;
  /** `X-WR-CALDESC`. */
  description?: string;
  /** `X-WR-TIMEZONE`, when the runtime knows it. */
  timeZone?: string;
  context: ReadContext;
  /** By `UID`, in document order. */
  groups: Map<string, EventGroup>;
};

/**
 * Parses iCalendar text. Floating times, UTC times and all-day bounds are read in the
 * calendar's `X-WR-TIMEZONE`, else in `defaultTimeZone`, else in UTC. Events without a
 * `UID` cannot be addressed, so they are skipped.
 */
export function parseICalendar(
  text: string,
  { calendarId, defaultTimeZone }: { calendarId: string; defaultTimeZone?: string },
): ParsedICalendar {
  let calendars: ICAL.Component[];
  try {
    const parsed: unknown = ICAL.parse(text);
    const list: unknown[][] = isJCalList(parsed) ? parsed : [parsed as unknown[]];
    calendars = list.map((jcal) => new ICAL.Component(jcal));
  } catch {
    // Neither the text nor the parser's error (which quotes it) is kept: an error page
    // served with status 200 can echo a feed's secret address.
    throw new InvalidResponseDataError({
      data: undefined,
      message: 'The response is not valid iCalendar data.',
    });
  }
  const calendar = calendars.find((component) => component.name === 'vcalendar');
  if (!calendar) {
    throw new InvalidResponseDataError({
      data: undefined,
      message: 'The response holds no VCALENDAR.',
    });
  }

  const declaredZone = textOf(calendar, 'x-wr-timezone');
  const timeZone = declaredZone && isValidTimeZone(declaredZone) ? declaredZone : undefined;

  const timezones = new Map<string, ICAL.Timezone>();
  const groups = new Map<string, EventGroup>();
  for (const component of calendars.filter((item) => item.name === 'vcalendar')) {
    for (const vtimezone of component.getAllSubcomponents('vtimezone')) {
      const tzid = textOf(vtimezone, 'tzid');
      if (tzid && !timezones.has(tzid)) timezones.set(tzid, new ICAL.Timezone(vtimezone));
    }
    for (const vevent of component.getAllSubcomponents('vevent')) {
      const uid = textOf(vevent, 'uid');
      // Cancellations of one instance need no times of their own.
      if (!uid || !(vevent.hasProperty('dtstart') || isCancellation(vevent))) continue;
      let group = groups.get(uid);
      if (!group) {
        group = { uid, exceptions: [] };
        groups.set(uid, group);
      }
      if (vevent.hasProperty('recurrence-id')) group.exceptions.push(vevent);
      else group.master ??= vevent;
    }
  }

  return {
    name: textOf(calendar, 'x-wr-calname'),
    description: textOf(calendar, 'x-wr-caldesc'),
    timeZone,
    context: { calendarId, timeZone: timeZone ?? defaultTimeZone ?? 'UTC', timezones },
    groups,
  };
}

// `ICAL.parse` returns one jCal component, or a list when the text holds several.
function isJCalList(value: unknown): value is unknown[][] {
  return Array.isArray(value) && Array.isArray(value[0]);
}

function isCancellation(vevent: ICAL.Component): boolean {
  return (
    vevent.hasProperty('recurrence-id') && textOf(vevent, 'status')?.toUpperCase() === 'CANCELLED'
  );
}

/** A trimmed text property, or `undefined` when missing or blank. */
export function textOf(component: ICAL.Component, name: string): string | undefined {
  const value = component.getFirstPropertyValue(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
