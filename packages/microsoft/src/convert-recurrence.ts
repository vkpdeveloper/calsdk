import {
  type EventTimeV1,
  InvalidArgumentError,
  UnsupportedFunctionalityError,
  type WarningV1,
} from '@calsdk/provider';
import {
  addDaysToDate,
  eventTimeToInstant,
  formatExdates,
  formatLocalDate,
  formatRRule,
  type ICalDate,
  instantToICalDate,
  instantToLocal,
  isAllDay,
  localToInstant,
  parseLocalDateTime,
  parseRecurrence,
  type RRule,
  WEEKDAYS,
  type Weekday,
} from '@calsdk/provider-utils';
import type { GraphRecurrence, GraphWeekday } from './microsoft-api';

// Outlook stores recurrence as a pattern plus a range instead of an RRULE. Only RRULEs
// with an exact pattern equivalent are written; anything else throws instead of
// silently scheduling different occurrences.

const TO_GRAPH_WEEKDAY: Record<Weekday, GraphWeekday> = {
  SU: 'sunday',
  MO: 'monday',
  TU: 'tuesday',
  WE: 'wednesday',
  TH: 'thursday',
  FR: 'friday',
  SA: 'saturday',
};
const FROM_GRAPH_WEEKDAY = Object.fromEntries(
  Object.entries(TO_GRAPH_WEEKDAY).map(([weekday, name]) => [name, weekday as Weekday]),
) as Record<GraphWeekday, Weekday>;

type GraphIndex = NonNullable<GraphRecurrence['pattern']['index']>;
const TO_GRAPH_INDEX = new Map<number, GraphIndex>([
  [1, 'first'],
  [2, 'second'],
  [3, 'third'],
  [4, 'fourth'],
  [-1, 'last'],
]);
const FROM_GRAPH_INDEX = new Map([...TO_GRAPH_INDEX].map(([n, index]) => [index, n]));

type Pattern = GraphRecurrence['pattern'];

function unsupported(what: string): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    provider: 'microsoft',
    functionality: 'recurrence',
    message: `Microsoft Outlook cannot represent ${what}. Use a rule Outlook supports: daily, weekly on set weekdays, monthly or yearly on a day or an nth weekday, ending by COUNT, UNTIL or never.`,
  });
}

/** Where the series starts, read in the zone its rule repeats in. */
function seriesStart(start: EventTimeV1) {
  const zone = isAllDay(start) ? 'UTC' : start.timeZone;
  const local = instantToLocal(eventTimeToInstant(start), zone);
  const date = formatLocalDate(local);
  return { zone, local, date, weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] };
}

/**
 * Converts RFC 5545 lines to an Outlook recurrence for a series starting at `start`.
 * Throws `UnsupportedFunctionalityError` for rules Outlook cannot represent exactly.
 *
 * Outlook keeps no exclusion list, only occurrences deleted one by one. So EXDATE lines are
 * accepted only for `cancelled` dates (the series' deleted occurrences, as local dates).
 */
export function toGraphRecurrence(
  lines: readonly string[],
  start: EventTimeV1,
  { cancelled = [], warnings }: { cancelled?: readonly string[]; warnings?: WarningV1[] } = {},
): GraphRecurrence {
  const parsed = parseRecurrence(lines);
  if (parsed.rdates.length > 0) throw unsupported('RDATE lines');
  if (parsed.other.length > 0) throw unsupported(`"${parsed.other[0]}"`);
  const series = seriesStart(start);
  const excluded = new Set(parsed.exdates.map((date) => localDate(date, series)));
  const added = [...excluded].filter((date) => !cancelled.includes(date));
  if (added.length > 0) {
    throw unsupported(
      `EXDATE lines for occurrences that were not deleted (${added.join(', ')}). Delete those occurrences instead`,
    );
  }
  if (cancelled.some((date) => !excluded.has(date))) {
    warnings?.push({
      type: 'unsupported',
      feature: 'recurrence',
      details: 'Outlook cannot restore deleted occurrences. They stay deleted.',
    });
  }
  const rule = parsed.rrule;
  if (!rule) {
    throw new InvalidArgumentError({
      argument: 'recurrence',
      message: 'A recurring event needs an RRULE line.',
    });
  }
  if (rule.other) throw unsupported(`the RRULE parts ${Object.keys(rule.other).join(', ')}`);
  return {
    pattern: toPattern(rule, series),
    range: {
      startDate: series.date,
      recurrenceTimeZone: series.zone,
      ...(rule.count !== undefined
        ? { type: 'numbered', numberOfOccurrences: rule.count }
        : rule.until !== undefined
          ? { type: 'endDate', endDate: lastDate(rule.until, series) }
          : { type: 'noEnd' }),
    },
  };
}

function toPattern(rule: RRule, series: ReturnType<typeof seriesStart>): Pattern {
  const interval = rule.interval ?? 1;
  const { byDay, byMonthDay, byMonth, bySetPos } = rule;
  switch (rule.freq) {
    case 'DAILY':
      if (byDay || byMonthDay || byMonth || bySetPos)
        throw unsupported('DAILY rules with BY parts');
      return { type: 'daily', interval };
    case 'WEEKLY':
      if (byMonth || bySetPos) throw unsupported('WEEKLY rules with BYMONTH or BYSETPOS');
      return {
        type: 'weekly',
        interval,
        daysOfWeek: (byDay ?? [{ weekday: series.weekday ?? 'MO' }]).map(
          ({ weekday }) => TO_GRAPH_WEEKDAY[weekday],
        ),
        firstDayOfWeek: TO_GRAPH_WEEKDAY[rule.weekStart ?? 'MO'],
      };
    case 'MONTHLY':
      if (byMonth) throw unsupported('MONTHLY rules with BYMONTH');
      return byDay
        ? { type: 'relativeMonthly', interval, ...relativeDays(rule) }
        : { type: 'absoluteMonthly', interval, dayOfMonth: monthDay(rule, series.local.day) };
    case 'YEARLY': {
      if (byMonth && byMonth.length > 1) throw unsupported('YEARLY rules with several months');
      // Without BYMONTH, BYDAY and BYMONTHDAY pick days in every month of the year.
      if (!byMonth && (byDay || byMonthDay)) {
        throw unsupported('YEARLY rules with BYDAY or BYMONTHDAY but no BYMONTH');
      }
      const month = byMonth?.[0] ?? series.local.month;
      return byDay
        ? { type: 'relativeYearly', interval, month, ...relativeDays(rule) }
        : {
            type: 'absoluteYearly',
            interval,
            month,
            dayOfMonth: monthDay(rule, series.local.day),
          };
    }
    default:
      throw unsupported(`FREQ=${rule.freq}`);
  }
}

/** `BYDAY=2TH`, or `BYDAY=MO,TU;BYSETPOS=-1` for "the last Monday or Tuesday". */
function relativeDays({ byDay = [], byMonthDay, bySetPos }: RRule) {
  if (byMonthDay) throw unsupported('rules with both BYDAY and BYMONTHDAY');
  const [first] = byDay;
  if (byDay.length === 1 && first?.n !== undefined && !bySetPos) {
    const index = TO_GRAPH_INDEX.get(first.n);
    if (index) return { index, daysOfWeek: [TO_GRAPH_WEEKDAY[first.weekday]] };
  }
  const index = bySetPos?.length === 1 ? TO_GRAPH_INDEX.get(bySetPos[0] ?? 0) : undefined;
  if (index && byDay.every((day) => day.n === undefined)) {
    return { index, daysOfWeek: byDay.map(({ weekday }) => TO_GRAPH_WEEKDAY[weekday]) };
  }
  throw unsupported(
    'this BYDAY combination. Use one nth weekday (2TH, -1FR) or weekdays with one BYSETPOS',
  );
}

/**
 * Outlook moves a day that a month lacks (the 31st) to the month's last day, while
 * RRULE skips that month. `BYMONTHDAY=28,29,30,31;BYSETPOS=-1` is the RRULE for
 * Outlook's behavior, so days past the 28th are only accepted in that form.
 */
function monthDay({ byMonthDay, bySetPos }: RRule, startDay: number): number {
  if (!byMonthDay) {
    if (bySetPos) throw unsupported('BYSETPOS without BYDAY or BYMONTHDAY');
    if (startDay > 28) {
      throw unsupported(
        `a series starting on day ${startDay} without BYMONTHDAY. Use BYMONTHDAY=${clampedDays(startDay)};BYSETPOS=-1 to repeat on that day or the month's last day`,
      );
    }
    return startDay;
  }
  const [day] = byMonthDay;
  if (byMonthDay.length === 1 && !bySetPos && day !== undefined && day >= 1 && day <= 28) {
    return day;
  }
  const last = byMonthDay.at(-1) ?? 0;
  if (bySetPos?.length === 1 && bySetPos[0] === -1 && byMonthDay.join(',') === clampedDays(last)) {
    return last;
  }
  throw unsupported(
    `BYMONTHDAY=${byMonthDay.join(',')}. Use one day from 1 to 28, or BYMONTHDAY=28,29,30,31;BYSETPOS=-1 style rules for later days`,
  );
}

function clampedDays(day: number): string {
  return Array.from({ length: Math.max(0, day - 27) }, (_, index) => 28 + index).join(',');
}

/** The last date an occurrence can fall on under `until`. */
function lastDate(until: ICalDate, series: ReturnType<typeof seriesStart>): string {
  if (until.type === 'date') return until.date;
  const local = parseLocalDateTime(until.local);
  if (!local) throw unsupported(`UNTIL=${until.local}`);
  const limit = localToInstant(local, until.timeZone ?? series.zone);
  const date = formatLocalDate(instantToLocal(limit, series.zone));
  // An occurrence on that date starts at the series' time of day, which may be after UNTIL.
  return occurrenceInstant(date, series) > limit ? addDaysToDate(date, -1) : date;
}

/** The date an EXDATE falls on in the series' zone. */
function localDate(date: ICalDate, series: ReturnType<typeof seriesStart>): string {
  if (date.type === 'date') return date.date;
  const local = parseLocalDateTime(date.local);
  if (!local) throw unsupported(`EXDATE ${date.local}`);
  return formatLocalDate(
    instantToLocal(localToInstant(local, date.timeZone ?? series.zone), series.zone),
  );
}

function occurrenceInstant(date: string, series: ReturnType<typeof seriesStart>): number {
  const day = parseLocalDateTime(date);
  if (!day) return Number.NaN;
  const { hour, minute, second } = series.local;
  return localToInstant({ ...day, hour, minute, second }, series.zone);
}

/**
 * Converts an Outlook recurrence to RFC 5545 lines for a series starting at `start`.
 * `cancelled` local dates of deleted occurrences become EXDATE lines.
 */
export function fromGraphRecurrence(
  recurrence: GraphRecurrence,
  start: EventTimeV1,
  cancelled: readonly string[] = [],
): string[] {
  const { pattern, range } = recurrence;
  const rule: RRule = { freq: 'DAILY', interval: pattern.interval };
  switch (pattern.type) {
    case 'daily':
      break;
    case 'weekly':
      rule.freq = 'WEEKLY';
      rule.byDay = (pattern.daysOfWeek ?? []).map((day) => ({ weekday: FROM_GRAPH_WEEKDAY[day] }));
      // The week start only changes which weeks an interval skips.
      if (pattern.interval > 1)
        rule.weekStart = FROM_GRAPH_WEEKDAY[pattern.firstDayOfWeek ?? 'sunday'];
      break;
    case 'absoluteMonthly':
    case 'absoluteYearly':
      rule.freq = pattern.type === 'absoluteMonthly' ? 'MONTHLY' : 'YEARLY';
      if (pattern.type === 'absoluteYearly' && pattern.month) rule.byMonth = [pattern.month];
      if (pattern.dayOfMonth !== undefined && pattern.dayOfMonth > 28) {
        rule.byMonthDay = clampedDays(pattern.dayOfMonth).split(',').map(Number);
        rule.bySetPos = [-1];
      } else if (pattern.dayOfMonth !== undefined) {
        rule.byMonthDay = [pattern.dayOfMonth];
      }
      break;
    case 'relativeMonthly':
    case 'relativeYearly': {
      rule.freq = pattern.type === 'relativeMonthly' ? 'MONTHLY' : 'YEARLY';
      if (pattern.type === 'relativeYearly' && pattern.month) rule.byMonth = [pattern.month];
      const n = FROM_GRAPH_INDEX.get(pattern.index ?? 'first') ?? 1;
      const days = (pattern.daysOfWeek ?? []).map((day) => FROM_GRAPH_WEEKDAY[day]);
      if (days.length === 1 && days[0]) {
        rule.byDay = [{ weekday: days[0], n }];
      } else {
        rule.byDay = days.map((weekday) => ({ weekday }));
        rule.bySetPos = [n];
      }
      break;
    }
  }
  if (range.type === 'numbered' && range.numberOfOccurrences) {
    rule.count = range.numberOfOccurrences;
  } else if (range.type === 'endDate' && range.endDate) {
    rule.until = isAllDay(start)
      ? { type: 'date', date: range.endDate }
      : instantToICalDate(occurrenceInstant(range.endDate, seriesStart(start)));
  }
  const exdates = cancelled.map(
    (date): ICalDate =>
      isAllDay(start)
        ? { type: 'date', date }
        : instantToICalDate(occurrenceInstant(date, seriesStart(start))),
  );
  return [formatRRule(rule), ...formatExdates(exdates)];
}

const GRAPH_WEEKDAYS = Object.values(TO_GRAPH_WEEKDAY);

/**
 * Moves a series `days` days, keeping every occurrence the same distance from the first.
 * Throws for monthly and yearly patterns, which pick days by date and do not move with it.
 */
export function shiftRecurrence(recurrence: GraphRecurrence, days: number): GraphRecurrence {
  if (days === 0) return recurrence;
  const { pattern, range } = recurrence;
  return {
    pattern: shiftPattern(pattern, days),
    range: {
      ...range,
      startDate: addDaysToDate(range.startDate, days),
      ...(range.type === 'endDate' && range.endDate
        ? { endDate: addDaysToDate(range.endDate, days) }
        : {}),
    },
  };
}

function shiftPattern(pattern: Pattern, days: number): Pattern {
  if (pattern.type === 'daily') return pattern;
  if (pattern.type === 'weekly') {
    const first = GRAPH_WEEKDAYS.indexOf(pattern.firstDayOfWeek ?? 'sunday');
    const step = ((days % 7) + 7) % 7;
    // Each day's place in the week, counted from the first day of the week.
    const places = (pattern.daysOfWeek ?? []).map(
      (day) => (GRAPH_WEEKDAYS.indexOf(day) - first + 7) % 7,
    );
    const wraps = places.map((place) => place + step >= 7);
    // Every few weeks, days moving into the next week while others stay would no longer
    // share a week.
    if (pattern.interval === 1 || wraps.every((wrap) => wrap === wraps[0])) {
      return {
        ...pattern,
        daysOfWeek: places.map((place) => GRAPH_WEEKDAYS[(first + place + step) % 7] ?? 'sunday'),
      };
    }
  }
  throw new UnsupportedFunctionalityError({
    provider: 'microsoft',
    functionality: 'moving a series to another day',
    message:
      'Outlook cannot move this series to another day through one occurrence: its pattern would pick different days. Update the series id with a new start and recurrence instead.',
  });
}
