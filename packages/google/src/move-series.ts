import {
  type EventTimeV1,
  InvalidArgumentError,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import {
  addDaysToDate,
  eventTimeToInstant,
  formatExdates,
  formatLocalDate,
  formatLocalDateTime,
  formatRdates,
  formatRRule,
  formatZonedDateTime,
  type ICalDate,
  instantToLocal,
  isAllDay,
  localToInstant,
  parseLocalDateTime,
  parseRecurrence,
  type RRule,
  WEEKDAYS,
} from '@calsdk/provider-utils';

const DAY_MS = 86_400_000;

/**
 * Moving a series by the distance one occurrence moves. The distance is measured on the
 * wall clock of the series' zone, so occurrences keep their local time across DST changes.
 */
export type SeriesMove = { zone: string; ms: number; allDay: boolean };

/** A time on the wall clock of `zone`, as epoch milliseconds read as UTC. */
function wallClock(time: EventTimeV1, zone: string): number {
  if (isAllDay(time)) return Date.parse(time.date);
  return localToInstant(instantToLocal(Date.parse(time.dateTime), zone), 'UTC');
}

/**
 * The move that takes `from` to `to`, in the series' `zone`. The series' rule repeats in
 * that zone, so `to` must keep it: its rule dates could not be translated to another.
 */
export function seriesMove(from: EventTimeV1, to: EventTimeV1, zone: string): SeriesMove {
  if (isAllDay(from) !== isAllDay(to)) {
    throw new InvalidArgumentError({
      argument: 'patch.start',
      message:
        'Switching a whole series between all-day and timed through one instance is not supported. Update the series id instead.',
    });
  }
  if (!isAllDay(to) && to.timeZone !== zone) {
    throw new InvalidArgumentError({
      argument: 'patch.start',
      message: `The series repeats in ${zone}. Changing its time zone through one instance is not supported. Update the series id instead.`,
    });
  }
  return { zone, ms: wallClock(to, zone) - wallClock(from, zone), allDay: isAllDay(to) };
}

export function moveTime(time: EventTimeV1, move: SeriesMove): EventTimeV1 {
  if (isAllDay(time) !== move.allDay) {
    throw new InvalidArgumentError({
      argument: 'patch.start',
      message: 'The series and the moved instance must both be all-day or both be timed.',
    });
  }
  if (isAllDay(time)) {
    return { date: formatLocalDate(instantToLocal(Date.parse(time.date) + move.ms, 'UTC')) };
  }
  return {
    dateTime: formatZonedDateTime(moveInstant(Date.parse(time.dateTime), move), time.timeZone),
    timeZone: time.timeZone,
  };
}

/**
 * The end of an event starting at `start` that lasts `ms` of elapsed time, written in the
 * form and zone of `like`. Elapsed, so a series keeps its length on DST days.
 */
export function endAfter(start: EventTimeV1, ms: number, like: EventTimeV1): EventTimeV1 {
  if (isAllDay(start) !== isAllDay(like)) {
    throw new InvalidArgumentError({
      argument: 'patch.end',
      message: 'The start and end must both be all-day or both be timed.',
    });
  }
  if (isAllDay(like)) {
    return { date: formatLocalDate(instantToLocal(eventTimeToInstant(start) + ms, 'UTC')) };
  }
  return {
    dateTime: formatZonedDateTime(eventTimeToInstant(start) + ms, like.timeZone),
    timeZone: like.timeZone,
  };
}

function moveInstant(instant: number, { zone, ms }: SeriesMove): number {
  const wall = localToInstant(instantToLocal(instant, zone), 'UTC') + ms;
  return localToInstant(instantToLocal(wall, 'UTC'), zone);
}

/**
 * Moves a series' rule with its start: weekdays, `UNTIL`, `EXDATE` and `RDATE` values move
 * by the same distance, so the same occurrences stay excluded or added. Throws when the
 * rule picks days a move cannot carry, such as days of the month.
 */
export function moveRecurrence(
  lines: readonly string[],
  seriesStart: EventTimeV1,
  move: SeriesMove,
): string[] {
  if (move.ms === 0) return [...lines];
  const parsed = parseRecurrence(lines);
  const rule = parsed.rrule;
  if (parsed.other.length > 0 || rule?.other) {
    throw cannotMove('Its recurrence has lines or RRULE parts calsdk cannot move, such as EXRULE');
  }
  const start = wallClock(seriesStart, move.zone);
  const days = Math.floor((start + move.ms) / DAY_MS) - Math.floor(start / DAY_MS);
  const shift = (date: ICalDate): ICalDate => {
    if (date.type === 'date') return { ...date, date: addDaysToDate(date.date, days) };
    const local = parseLocalDateTime(date.local);
    if (!local) throw cannotMove(`The date "${date.local}" is not valid`);
    // Kept in its own zone (or floating), so the line keeps its form.
    const zone = date.timeZone ?? move.zone;
    const moved = moveInstant(localToInstant(local, zone), move);
    const { millisecond: _, ...wall } = instantToLocal(moved, zone);
    return { ...date, local: formatLocalDateTime(wall) };
  };
  return [
    ...(rule
      ? [
          formatRRule({
            ...rule,
            byDay: moveWeekdays(rule, days),
            until: rule.until && shift(rule.until),
          }),
        ]
      : []),
    ...formatExdates(parsed.exdates.map(shift)),
    ...formatRdates(parsed.rdates.map(shift)),
  ];
}

function moveWeekdays(
  { freq, byDay, byMonthDay, byMonth, bySetPos, ...rule }: RRule,
  days: number,
) {
  if (days === 0) return byDay;
  // Daily and weekly rules repeat by days, so their occurrences move with the start. Months
  // and years have different lengths, so their days do not.
  const byDays = freq === 'DAILY' || freq === 'WEEKLY';
  if (!byDays || byMonthDay || byMonth || bySetPos || byDay?.some((day) => day.n !== undefined)) {
    throw cannotMove('Its rule picks days by month or year, which do not move with the date');
  }
  if (!byDay) return undefined;
  const first = WEEKDAYS.indexOf(rule.weekStart ?? 'MO');
  const step = ((days % 7) + 7) % 7;
  // Each day's place in the week, counted from the week start.
  const places = byDay.map(({ weekday }) => (WEEKDAYS.indexOf(weekday) - first + 7) % 7);
  const wraps = places.map((place) => place + step >= 7);
  // Every few weeks, days moving into the next week while others stay no longer share a week.
  if (freq === 'WEEKLY' && (rule.interval ?? 1) > 1 && wraps.some((wrap) => wrap !== wraps[0])) {
    throw cannotMove('Some of its weekdays would move into the next week and others not');
  }
  return places.map((place) => ({ weekday: WEEKDAYS[(first + place + step) % 7] ?? 'MO' }));
}

function cannotMove(reason: string): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    provider: 'google',
    functionality: 'moving a series through one instance',
    message: `This series cannot be moved through one instance. ${reason}. Update the series id with a new start and recurrence instead.`,
  });
}
