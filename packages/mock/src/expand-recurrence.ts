import {
  type EventTimeV1,
  InvalidArgumentError,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import {
  addDaysToDate,
  eventTimeToInstant,
  formatICalDate,
  formatRRule,
  formatZonedDateTime,
  isAllDay,
  localToInstant,
  parseLocalDateTime,
  parseRecurrence,
  type RRule,
} from '@calsdk/provider-utils';
import { RRuleTemporal } from 'rrule-temporal';

/** One instance of a recurring event. */
export type Instance = {
  start: EventTimeV1;
  end: EventTimeV1;
  startInstant: number;
  endInstant: number;
};

export type RecurringEvent = {
  start: EventTimeV1;
  end: EventTimeV1;
  recurrence: readonly string[];
};

const DAY_MS = 86_400_000;

/** RRULE parts provider-utils keeps in `other`, with their RFC 5545 value ranges. */
// RFC 5545 allows BYSECOND=60 for leap seconds, which the library drops: it is rejected
// as unsupported below rather than accepted here.
const EXTRA_PARTS: Record<string, [min: number, max: number]> = {
  BYSECOND: [0, 59],
  BYMINUTE: [0, 59],
  BYHOUR: [0, 23],
  BYYEARDAY: [-366, 366],
  BYWEEKNO: [-53, 53],
};

const TIME_PARTS = new Set(['BYSECOND', 'BYMINUTE', 'BYHOUR']);

// The library's default of 10,000 periods is too low for long COUNT series queried far
// from their start (a daily series over 30 years). It stops early on impossible rules.
const MAX_ITERATIONS = 1_000_000;

function unsupported(feature: string): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    provider: 'mock',
    functionality: `recurrence with ${feature}`,
    message: `The mock provider does not support recurrence with ${feature}. It supports one RRULE line plus EXDATE lines.`,
  });
}

/**
 * Builds the RFC 5545 rule. Timed events recur on the wall clock of their own time
 * zone, so a 10:00 meeting stays at 10:00 across DST changes. All-day events recur
 * on dates. `includeDtstart` keeps the series start as the first instance even when
 * it does not match the rule, like Google does.
 */
function ruleOf(event: RecurringEvent, rrule: RRule): RRuleTemporal {
  const line = formatRRule(rrule);
  try {
    if (isAllDay(event.start)) {
      const dtstart = formatICalDate({ type: 'date', date: event.start.date });
      return new RRuleTemporal({
        rruleString: `DTSTART;VALUE=DATE:${dtstart}\n${line}`,
        includeDtstart: true,
        maxIterations: MAX_ITERATIONS,
      });
    }
    // An exact instant keeps DTSTART on the right side of a DST fold.
    const { timeZone } = event.start;
    const instant = new Date(eventTimeToInstant(event.start, timeZone)).toISOString();
    return new RRuleTemporal({
      rruleString: line,
      dtstart: { timeZoneId: timeZone, toString: () => `${instant}[${timeZone}]` },
      includeDtstart: true,
      maxIterations: MAX_ITERATIONS,
    });
  } catch (error) {
    throw new InvalidArgumentError({
      argument: 'recurrence',
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }
}

/**
 * Throws `UnsupportedFunctionalityError` unless the mock can expand these recurrence
 * lines, and `InvalidArgumentError` when they are invalid for this event.
 */
export function assertSupportedRecurrence(event: RecurringEvent): void {
  const parsed = parseRecurrence(event.recurrence);
  if (!parsed.rrule) throw unsupported('no RRULE line');
  if (parsed.rdates.length > 0) throw unsupported('RDATE');
  const [otherLine] = parsed.other;
  if (otherLine) throw unsupported(otherLine.split(/[;:]/, 1)[0] ?? otherLine);

  // rrule-temporal ignores unknown parts and clamps some values in non-strict mode,
  // so check the parts provider-utils does not model before trusting it.
  for (const [part, value] of Object.entries(parsed.rrule.other ?? {})) {
    if (isAllDay(event.start) && TIME_PARTS.has(part)) {
      throw new InvalidArgumentError({
        argument: 'recurrence',
        message: `${part} cannot be used in the rule of an all-day event (RFC 5545).`,
      });
    }
    if (part === 'BYSECOND' && value.split(',').includes('60')) throw unsupported('leap seconds');
    const range = Object.hasOwn(EXTRA_PARTS, part) ? EXTRA_PARTS[part] : undefined;
    if (!range) throw unsupported(part);
    const [min, max] = range;
    const valid = value.split(',').every((item) => {
      const number = Number(item);
      return (
        /^[+-]?\d+$/.test(item) && number >= min && number <= max && (min >= 0 || number !== 0)
      );
    });
    if (!valid) {
      throw new InvalidArgumentError({
        argument: 'recurrence',
        message: `${part} values must be integers from ${min} to ${max}${min < 0 ? ', except 0' : ''}.`,
      });
    }
  }
  ruleOf(event, parsed.rrule);
}

/**
 * Instances whose start falls in `[from, to)`, in start order, honoring COUNT,
 * UNTIL and EXDATE. `includeExcluded` also returns EXDATE instances, which still
 * count toward COUNT. All-day events use `allDayTimeZone` only to compute instants.
 */
export function instancesBetween(
  event: RecurringEvent,
  allDayTimeZone: string,
  from: number,
  to: number,
  { includeExcluded = false }: { includeExcluded?: boolean } = {},
): Instance[] {
  const parsed = parseRecurrence(event.recurrence);
  if (!parsed.rrule) throw unsupported('no RRULE line');
  const rule = ruleOf(event, parsed.rrule);

  const seriesStart = eventTimeToInstant(event.start, allDayTimeZone);
  const durationMs = eventTimeToInstant(event.end, allDayTimeZone) - seriesStart;
  const durationDays =
    isAllDay(event.start) && isAllDay(event.end)
      ? Math.round((Date.parse(event.end.date) - Date.parse(event.start.date)) / DAY_MS)
      : 0;
  const timeZone = isAllDay(event.start) ? allDayTimeZone : event.start.timeZone;
  const endZone = isAllDay(event.end) ? timeZone : event.end.timeZone;

  // Date-time EXDATEs remove the instance starting at that instant, date EXDATEs
  // remove any instance starting on that local date.
  const excludedInstants = new Set<number>();
  const excludedDates = new Set<string>();
  for (const date of parsed.exdates) {
    if (date.type === 'date') excludedDates.add(date.date);
    else {
      const local = parseLocalDateTime(date.local);
      if (local) excludedInstants.add(localToInstant(local, date.timeZone ?? timeZone));
    }
  }

  // All-day rules run on UTC dates, which can be up to a day away from instants in
  // `allDayTimeZone`, so query a wider window and filter on the real instants.
  const lower = new Date(Math.max(from, seriesStart) - DAY_MS);
  const upper = new Date(to + DAY_MS);
  if (lower >= upper) return [];

  const instances: Instance[] = [];
  for (const occurrence of rule.between(lower, upper, true)) {
    let instance: Instance;
    if (isAllDay(event.start)) {
      const date = occurrence.toPlainDate().toString();
      const endDate = addDaysToDate(date, durationDays);
      instance = {
        start: { date },
        end: { date: endDate },
        startInstant: eventTimeToInstant({ date }, allDayTimeZone),
        endInstant: eventTimeToInstant({ date: endDate }, allDayTimeZone),
      };
    } else {
      const startInstant = occurrence.epochMilliseconds;
      const endInstant = startInstant + durationMs;
      instance = {
        start: { dateTime: formatZonedDateTime(startInstant, timeZone), timeZone },
        end: { dateTime: formatZonedDateTime(endInstant, endZone), timeZone: endZone },
        startInstant,
        endInstant,
      };
    }
    if (instance.startInstant < from || instance.startInstant >= to) continue;
    const excluded =
      excludedInstants.has(instance.startInstant) ||
      excludedDates.has(occurrence.toPlainDate().toString());
    if (includeExcluded || !excluded) instances.push(instance);
  }
  return instances;
}

/** Instances overlapping `[rangeStart, rangeEnd)`, in start order. */
export function expandInRange(
  event: RecurringEvent,
  allDayTimeZone: string,
  rangeStart: number,
  rangeEnd: number,
): Instance[] {
  const seriesStart = eventTimeToInstant(event.start, allDayTimeZone);
  // Instances can be a DST hour longer than the series start, hence the extra day.
  const longest = eventTimeToInstant(event.end, allDayTimeZone) - seriesStart + DAY_MS;
  return instancesBetween(event, allDayTimeZone, rangeStart - longest, rangeEnd).filter(
    (instance) => instance.endInstant > rangeStart,
  );
}
