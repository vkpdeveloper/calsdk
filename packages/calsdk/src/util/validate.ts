import {
  type EventInputV1,
  type EventPatchV1,
  type EventTimeV1,
  InvalidArgumentError,
} from '@calsdk/provider';
import {
  formatZonedDateTime,
  isValidTimeZone,
  localToInstant,
  parseLocalDateTime,
  parseRecurrence,
  windowsToIana,
} from '@calsdk/provider-utils';
import type { TimeInput } from '../types';

const invalid = (argument: string, message: string) =>
  new InvalidArgumentError({ argument, message });

/** Converts a `Date` or ISO string to an ISO string, rejecting unparseable values. */
export function toISOString(value: TimeInput, argument: string): string {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  if (!date || Number.isNaN(date.getTime())) {
    throw invalid(
      argument,
      'Expected a Date or an ISO 8601 string such as "2026-11-03T10:00:00Z".',
    );
  }
  return date.toISOString();
}

/** Validates and converts a `[timeMin, timeMax)` window. */
export function toTimeRange(timeMin: TimeInput, timeMax: TimeInput) {
  const range = {
    timeMin: toISOString(timeMin, 'timeMin'),
    timeMax: toISOString(timeMax, 'timeMax'),
  };
  if (range.timeMin >= range.timeMax) throw invalid('timeMax', 'timeMax must be after timeMin.');
  return range;
}

export function requireId(value: unknown, argument: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(argument, 'Expected a non-empty string id.');
  }
  return value;
}

export function validatePageSize(pageSize: number | undefined): number | undefined {
  if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1)) {
    throw invalid('pageSize', 'pageSize must be a positive integer.');
  }
  return pageSize;
}

const OFFSET = /(?:Z|([+-])(\d{2}):(\d{2}))$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

/**
 * Validates an event time. A timed value without an offset is read as wall-clock
 * time in its `timeZone`, so `{ dateTime: '2026-11-03T10:00:00', timeZone: 'Asia/Kolkata' }`
 * becomes `'2026-11-03T10:00:00+05:30'`. Providers always receive explicit offsets.
 */
export function normalizeEventTime(time: unknown, argument: string): EventTimeV1 {
  if (typeof time !== 'object' || time === null) {
    throw invalid(
      argument,
      'Expected { dateTime, timeZone } for timed events or { date } for all-day events.',
    );
  }
  const hasDate = 'date' in time && time.date !== undefined;
  const hasDateTime = 'dateTime' in time && time.dateTime !== undefined;
  if (hasDate === hasDateTime) {
    throw invalid(
      argument,
      'Set either { dateTime, timeZone } (timed) or { date } (all-day), not both.',
    );
  }

  if (hasDate) {
    const { date } = time as { date: unknown };
    if (typeof date !== 'string' || !DATE.test(date) || !isRealDate(date)) {
      throw invalid(`${argument}.date`, 'Expected a calendar date in YYYY-MM-DD format.');
    }
    return { date };
  }

  const { dateTime, timeZone } = time as { dateTime: unknown; timeZone?: unknown };
  if (typeof timeZone !== 'string' || !isValidTimeZone(timeZone)) {
    const iana = typeof timeZone === 'string' ? windowsToIana(timeZone) : undefined;
    throw invalid(
      `${argument}.timeZone`,
      iana
        ? `"${timeZone}" is a Windows time zone name. Use the IANA name "${iana}".`
        : 'Expected an IANA time zone such as "Asia/Kolkata" or "America/New_York".',
    );
  }
  if (typeof dateTime !== 'string') {
    throw invalid(`${argument}.dateTime`, 'Expected an ISO 8601 date-time string.');
  }
  // Date.parse and Date.UTC roll impossible values over (25:00 becomes the next day),
  // so check every component before converting.
  const offset = OFFSET.exec(dateTime);
  const local = parseLocalDateTime(offset ? dateTime.slice(0, offset.index) : dateTime);
  if (
    !local ||
    !dateTime.includes('T') ||
    !isRealDate(dateTime.slice(0, 10)) ||
    local.hour > 23 ||
    local.minute > 59 ||
    local.second > 59 ||
    Number(offset?.[2] ?? 0) > 23 ||
    Number(offset?.[3] ?? 0) > 59
  ) {
    throw invalid(`${argument}.dateTime`, `"${dateTime}" is not a valid ISO 8601 date-time.`);
  }
  if (offset) return { dateTime, timeZone };
  return { dateTime: formatZonedDateTime(localToInstant(local, timeZone), timeZone), timeZone };
}

function compareTimes(start: EventTimeV1, end: EventTimeV1, argument: string) {
  if ('date' in start !== 'date' in end) {
    throw invalid(
      `${argument}.end`,
      'start and end must both be all-day ({ date }) or both timed ({ dateTime, timeZone }).',
    );
  }
  const isAfter =
    'date' in start && 'date' in end
      ? end.date > start.date
      : 'dateTime' in start &&
        'dateTime' in end &&
        Date.parse(end.dateTime) > Date.parse(start.dateTime);
  if (!isAfter) {
    throw invalid(
      `${argument}.end`,
      'end must be after start. All-day end dates are exclusive: a one-day event on the 3rd ends on the 4th.',
    );
  }
}

function validateRecurrence(recurrence: unknown, argument: string): string[] {
  if (!Array.isArray(recurrence) || recurrence.some((line) => typeof line !== 'string')) {
    throw invalid(
      argument,
      "Expected an array of RFC 5545 lines, e.g. ['RRULE:FREQ=WEEKLY;BYDAY=MO'].",
    );
  }
  if (recurrence.some((line: string) => /[\r\n]/.test(line))) {
    throw invalid(
      argument,
      'Recurrence lines must not contain line breaks. Pass one array item per line.',
    );
  }
  parseRecurrence(recurrence);
  return recurrence;
}

function validateColor(color: unknown, argument: string) {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    throw invalid(argument, 'Expected a hex color such as "#1a73e8".');
  }
}

function validateAttendees(attendees: unknown, argument: string) {
  if (!Array.isArray(attendees)) throw invalid(argument, 'Expected an array of { email }.');
  attendees.forEach((attendee: unknown, index) => {
    const email =
      typeof attendee === 'object' && attendee !== null && 'email' in attendee
        ? attendee.email
        : undefined;
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw invalid(`${argument}[${index}].email`, 'Expected an email address.');
    }
  });
}

function validateReminders(reminders: unknown, argument: string) {
  const overrides =
    typeof reminders === 'object' && reminders !== null && 'overrides' in reminders
      ? reminders.overrides
      : undefined;
  if (overrides === undefined) return;
  if (
    !Array.isArray(overrides) ||
    overrides.some(
      (override: { minutesBefore?: unknown }) =>
        !Number.isInteger(override?.minutesBefore) || (override.minutesBefore as number) < 0,
    )
  ) {
    throw invalid(
      `${argument}.overrides`,
      'Each override needs a non-negative integer minutesBefore.',
    );
  }
}

/** Validates an event for creation and normalizes its times. */
export function validateEventInput(event: EventInputV1): EventInputV1 {
  if (typeof event !== 'object' || event === null) {
    throw invalid('event', 'Expected an event object with at least start and end.');
  }
  const start = normalizeEventTime(event.start, 'event.start');
  const end = normalizeEventTime(event.end, 'event.end');
  compareTimes(start, end, 'event');
  if (event.recurrence !== undefined) validateRecurrence(event.recurrence, 'event.recurrence');
  if (event.color !== undefined) validateColor(event.color, 'event.color');
  if (event.attendees !== undefined) validateAttendees(event.attendees, 'event.attendees');
  if (event.reminders !== undefined) validateReminders(event.reminders, 'event.reminders');
  return { ...event, start, end };
}

/** Validates a patch and normalizes the times it sets. */
export function validateEventPatch(patch: EventPatchV1): EventPatchV1 {
  if (typeof patch !== 'object' || patch === null) {
    throw invalid('patch', 'Expected an object with the fields to change.');
  }
  for (const key of ['start', 'end'] as const) {
    if (patch[key] === null) {
      throw invalid(`patch.${key}`, `${key} cannot be cleared, only replaced.`);
    }
  }
  const start =
    patch.start === undefined ? undefined : normalizeEventTime(patch.start, 'patch.start');
  const end = patch.end === undefined ? undefined : normalizeEventTime(patch.end, 'patch.end');
  if (start && end) compareTimes(start, end, 'patch');
  if (patch.recurrence != null) validateRecurrence(patch.recurrence, 'patch.recurrence');
  if (patch.color != null) validateColor(patch.color, 'patch.color');
  if (patch.attendees != null) validateAttendees(patch.attendees, 'patch.attendees');
  if (patch.reminders != null) validateReminders(patch.reminders, 'patch.reminders');
  return {
    ...patch,
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  };
}
