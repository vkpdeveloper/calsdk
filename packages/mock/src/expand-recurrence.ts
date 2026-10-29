import { type EventTimeV1, UnsupportedFunctionalityError } from '@calsdk/provider';
import {
  addDaysToDate,
  eventTimeToInstant,
  formatLocalDate,
  formatZonedDateTime,
  type ICalDate,
  instantToLocal,
  isAllDay,
  type LocalDateTime,
  localToInstant,
  parseLocalDateTime,
  parseRecurrence,
  type RRule,
  WEEKDAYS,
} from '@calsdk/provider-utils';

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
// A rule that matches no day for this many periods in a row is treated as finished
// (e.g. FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30).
const MAX_EMPTY_PERIODS = 1_000;

type Day = { year: number; month: number; day: number };

const dayNumber = (day: Day) => Date.UTC(day.year, day.month - 1, day.day) / DAY_MS;
const weekdayOf = (n: number) => new Date(n * DAY_MS).getUTCDay();
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const dayFromNumber = (n: number): Day => {
  const date = new Date(n * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

function unsupported(feature: string): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    provider: 'mock',
    functionality: `recurrence with ${feature}`,
    message: `The mock provider does not support recurrence with ${feature}. It supports DAILY, WEEKLY, MONTHLY and YEARLY rules with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, WKST and EXDATE.`,
  });
}

/** Throws `UnsupportedFunctionalityError` unless the mock can expand these recurrence lines. */
export function assertSupportedRecurrence(recurrence: readonly string[]): RRule {
  const parsed = parseRecurrence(recurrence);
  if (!parsed.rrule) throw unsupported('no RRULE line');
  if (parsed.rdates.length > 0) throw unsupported('RDATE');
  const [otherLine] = parsed.other;
  if (otherLine) throw unsupported(otherLine.split(/[;:]/, 1)[0] ?? otherLine);

  const rule = parsed.rrule;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq)) {
    throw unsupported(`FREQ=${rule.freq}`);
  }
  if (rule.bySetPos) throw unsupported('BYSETPOS');
  const [otherPart] = Object.keys(rule.other ?? {});
  if (otherPart) throw unsupported(otherPart);
  if (rule.byDay?.some((day) => day.n !== undefined) && rule.freq !== 'MONTHLY') {
    throw unsupported(`numbered BYDAY with FREQ=${rule.freq}`);
  }
  if (rule.freq === 'YEARLY' && rule.byDay) throw unsupported('BYDAY with FREQ=YEARLY');
  return rule;
}

/** Candidate days of the `period`-th recurrence period, before filtering by the series start. */
function periodDays(rule: RRule, first: Day, period: number): number[] {
  const interval = rule.interval ?? 1;
  const firstNumber = dayNumber(first);
  const weekdays = rule.byDay?.map(({ weekday }) => WEEKDAYS.indexOf(weekday));

  switch (rule.freq) {
    case 'DAILY':
      return [firstNumber + period * interval];

    case 'WEEKLY': {
      const weekStart = WEEKDAYS.indexOf(rule.weekStart ?? 'MO');
      const firstWeek = firstNumber - ((weekdayOf(firstNumber) - weekStart + 7) % 7);
      const week = firstWeek + period * interval * 7;
      return (weekdays ?? [weekdayOf(firstNumber)]).map(
        (weekday) => week + ((weekday - weekStart + 7) % 7),
      );
    }

    case 'MONTHLY': {
      const monthIndex = first.year * 12 + (first.month - 1) + period * interval;
      const year = Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      return monthDays(rule, year, month, first.day);
    }

    default: {
      const year = first.year + period * interval;
      return (rule.byMonth ?? [first.month]).flatMap((month) =>
        monthDays(rule, year, month, first.day),
      );
    }
  }
}

function monthDays(rule: RRule, year: number, month: number, defaultDay: number): number[] {
  const length = daysInMonth(year, month);
  const firstOfMonth = dayNumber({ year, month, day: 1 });

  const byMonthDay = rule.byMonthDay
    ?.map((day) => (day > 0 ? day : length + 1 + day))
    .filter((day) => day >= 1 && day <= length);

  let byDay: number[] | undefined;
  if (rule.byDay) {
    byDay = rule.byDay.flatMap(({ weekday, n }) => {
      const target = WEEKDAYS.indexOf(weekday);
      const matches: number[] = [];
      for (let day = 1; day <= length; day++) {
        if (weekdayOf(firstOfMonth + day - 1) === target) matches.push(day);
      }
      if (n === undefined) return matches;
      const match = n > 0 ? matches[n - 1] : matches[matches.length + n];
      return match === undefined ? [] : [match];
    });
  }

  let days: number[];
  if (byMonthDay && byDay) days = byMonthDay.filter((day) => byDay.includes(day));
  else days = byMonthDay ?? byDay ?? (defaultDay <= length ? [defaultDay] : []);
  return days.map((day) => firstOfMonth + day - 1);
}

function matchesFilters(rule: RRule, n: number): boolean {
  const day = dayFromNumber(n);
  if (rule.byMonth && !rule.byMonth.includes(day.month)) return false;
  if (rule.freq === 'DAILY') {
    if (
      rule.byDay &&
      !rule.byDay.some(({ weekday }) => WEEKDAYS.indexOf(weekday) === weekdayOf(n))
    ) {
      return false;
    }
    if (
      rule.byMonthDay &&
      !monthDays({ ...rule, byDay: undefined }, day.year, day.month, 0).includes(n)
    ) {
      return false;
    }
  }
  return true;
}

function untilInstant(until: ICalDate, timeZone: string): number {
  if (until.type === 'date') {
    const local = parseLocalDateTime(until.date) as LocalDateTime;
    // A date UNTIL includes the whole day.
    return localToInstant(local, timeZone) + DAY_MS - 1;
  }
  return localToInstant(
    parseLocalDateTime(until.local) as LocalDateTime,
    until.timeZone ?? timeZone,
  );
}

/**
 * Lazily yields every instance of a recurring event in start order, honoring
 * COUNT, UNTIL and EXDATE. The series start is always the first instance.
 * `includeExcluded` also yields EXDATE instances, which still count toward COUNT.
 *
 * Timed events recur on the wall clock of their own time zone, so a 10:00
 * meeting stays at 10:00 across DST changes. All-day events use `allDayTimeZone`
 * only to compute instants.
 */
export function* iterateInstances(
  event: RecurringEvent,
  allDayTimeZone: string,
  { includeExcluded = false }: { includeExcluded?: boolean } = {},
): Generator<Instance> {
  const rule = assertSupportedRecurrence(event.recurrence);
  const parsed = parseRecurrence(event.recurrence);
  const allDay = isAllDay(event.start);
  const timeZone = 'timeZone' in event.start ? event.start.timeZone : allDayTimeZone;

  const seriesStart = eventTimeToInstant(event.start, allDayTimeZone);
  const durationMs = eventTimeToInstant(event.end, allDayTimeZone) - seriesStart;
  const startLocal = instantToLocal(seriesStart, timeZone);
  const durationDays =
    isAllDay(event.start) && isAllDay(event.end)
      ? dayNumber(parseLocalDateTime(event.end.date) as Day) -
        dayNumber(parseLocalDateTime(event.start.date) as Day)
      : 0;

  // Date-time EXDATEs remove the instance starting at that instant, date EXDATEs
  // remove any instance starting on that local date.
  const excludedInstants = new Set(
    parsed.exdates.flatMap((date) =>
      date.type === 'date-time'
        ? [
            localToInstant(
              parseLocalDateTime(date.local) as LocalDateTime,
              date.timeZone ?? timeZone,
            ),
          ]
        : [],
    ),
  );
  const excludedDates = new Set(
    parsed.exdates.flatMap((date) => (date.type === 'date' ? [date.date] : [])),
  );
  const until = rule.until ? untilInstant(rule.until, timeZone) : Number.POSITIVE_INFINITY;
  const firstNumber = dayNumber(startLocal);

  const toInstance = (n: number): Instance => {
    const day = dayFromNumber(n);
    if (allDay) {
      const date = formatLocalDate(day);
      const startInstant = localToInstant({ ...day, hour: 0, minute: 0, second: 0 }, timeZone);
      return {
        start: { date },
        end: { date: addDaysToDate(date, durationDays) },
        startInstant,
        endInstant: localToInstant(
          { ...dayFromNumber(n + durationDays), hour: 0, minute: 0, second: 0 },
          timeZone,
        ),
      };
    }
    const startInstant = localToInstant({ ...startLocal, ...day }, timeZone);
    const endInstant = startInstant + durationMs;
    const endZone = 'timeZone' in event.end ? event.end.timeZone : timeZone;
    return {
      start: { dateTime: formatZonedDateTime(startInstant, timeZone), timeZone },
      end: { dateTime: formatZonedDateTime(endInstant, endZone), timeZone: endZone },
      startInstant,
      endInstant,
    };
  };

  let emitted = 0;
  let emptyPeriods = 0;
  let seenStart = false;
  for (let period = 0; emptyPeriods < MAX_EMPTY_PERIODS; period++) {
    const days = [
      ...new Set(
        periodDays(rule, startLocal, period).filter(
          (n) => n > firstNumber && matchesFilters(rule, n),
        ),
      ),
    ].sort((a, b) => a - b);
    if (!seenStart) {
      days.unshift(firstNumber);
      seenStart = true;
    }
    emptyPeriods = days.length === 0 ? emptyPeriods + 1 : 0;

    for (const n of days) {
      const instance = toInstance(n);
      if (instance.startInstant > until) return;
      emitted++;
      const isExcluded =
        excludedInstants.has(instance.startInstant) ||
        excludedDates.has(formatLocalDate(dayFromNumber(n)));
      if (includeExcluded || !isExcluded) yield instance;
      if (rule.count !== undefined && emitted >= rule.count) return;
    }
  }
}

/** Instances overlapping `[rangeStart, rangeEnd)`, in start order. */
export function expandInRange(
  event: RecurringEvent,
  allDayTimeZone: string,
  rangeStart: number,
  rangeEnd: number,
): Instance[] {
  const instances: Instance[] = [];
  for (const instance of iterateInstances(event, allDayTimeZone)) {
    if (instance.startInstant >= rangeEnd) break;
    if (instance.endInstant > rangeStart) instances.push(instance);
  }
  return instances;
}
