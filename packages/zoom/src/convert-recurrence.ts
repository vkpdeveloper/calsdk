import { UnsupportedFunctionalityError } from '@calsdk/provider';
import {
  formatExdates,
  formatRRule,
  type ICalDate,
  instantToICalDate,
  instantToLocal,
  localToInstant,
  parseLocalDateTime,
  parseRecurrence,
  type RRule,
  WEEKDAYS,
  type Weekday,
} from '@calsdk/provider-utils';
import type { ZoomRecurrence } from './zoom-api';

// Zoom stores recurrence as a daily, weekly or monthly pattern instead of an RRULE. Only
// RRULEs with an exact Zoom equivalent are written; anything else throws instead of
// scheduling different meetings.

const MAX_INTERVAL = { DAILY: 99, WEEKLY: 50, MONTHLY: 10 } as const;
const MAX_COUNT = 60;
const NTH_WEEKS = [1, 2, 3, 4, -1];

function unsupported(what: string): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    provider: 'zoom',
    functionality: 'recurrence',
    message: `Zoom cannot schedule ${what}. Use a rule Zoom supports: daily, weekly on set weekdays, or monthly on a day or an nth weekday, every up to 99 days, 50 weeks or 10 months, ending after up to ${MAX_COUNT} meetings or on a date.`,
  });
}

/** `1` for Sunday to `7` for Saturday, as Zoom numbers weekdays. */
const zoomWeekday = (weekday: Weekday) => WEEKDAYS.indexOf(weekday) + 1;

/**
 * The Zoom recurrence for RFC 5545 lines, for a series whose first meeting starts at `start`
 * in `timeZone`. EXDATE lines are accepted only for occurrences in `deleted` (instants of
 * occurrences already deleted one by one), as Zoom keeps no list of excluded dates.
 */
export function toZoomRecurrence(
  lines: readonly string[],
  { start, timeZone, deleted = [] }: { start: number; timeZone: string; deleted?: number[] },
): ZoomRecurrence {
  const parsed = parseRecurrence(lines);
  if (parsed.rdates.length > 0) throw unsupported('RDATE lines');
  if (parsed.other.length > 0) throw unsupported(`"${parsed.other[0]}"`);
  const excluded = parsed.exdates.map((date) => instantOf(date, timeZone));
  if (excluded.some((instant) => !deleted.includes(instant))) {
    throw unsupported(
      'EXDATE lines for meetings that were not deleted. Delete those occurrences instead',
    );
  }
  const rule = parsed.rrule;
  if (!rule) throw unsupported('recurrence without an RRULE line');
  if (rule.other) throw unsupported(`the RRULE parts ${Object.keys(rule.other).join(', ')}`);
  if (rule.byMonth) throw unsupported('BYMONTH');
  if (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY' && rule.freq !== 'MONTHLY') {
    throw unsupported(`FREQ=${rule.freq}`);
  }
  const interval = rule.interval ?? 1;
  if (interval > MAX_INTERVAL[rule.freq])
    throw unsupported(`INTERVAL=${interval} with FREQ=${rule.freq}`);
  if (rule.count !== undefined && rule.count > MAX_COUNT) throw unsupported(`COUNT=${rule.count}`);

  const local = instantToLocal(start, timeZone);
  const weekday = WEEKDAYS[new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()];
  if (!weekday) throw unsupported('this start');
  const end = {
    end_times: rule.count ?? (rule.until === undefined ? 0 : undefined),
    end_date_time:
      rule.until === undefined ? undefined : isoSeconds(instantOf(rule.until, timeZone, true)),
  };
  const base = { repeat_interval: interval, ...end };

  if (rule.freq === 'DAILY') {
    if (rule.byDay || rule.byMonthDay || rule.bySetPos)
      throw unsupported('a daily rule with BY parts');
    return { type: 1, ...base };
  }
  if (rule.freq === 'WEEKLY') {
    if (rule.byMonthDay || rule.bySetPos)
      throw unsupported('a weekly rule with BYMONTHDAY or BYSETPOS');
    const days = rule.byDay?.map((day) => day.weekday) ?? [weekday];
    // Zoom's weeks start on Monday, as RFC 5545's do by default. The week start changes
    // which days a rule repeating every few weeks on several days picks.
    if (rule.weekStart && rule.weekStart !== 'MO' && interval > 1 && new Set(days).size > 1) {
      throw unsupported(`WKST=${rule.weekStart} with INTERVAL=${interval}`);
    }
    // RFC 5545 counts the start as a meeting even off the rule's days. Zoom does not.
    if (!days.includes(weekday))
      throw unsupported('a weekly rule whose days leave out the first meeting');
    return {
      type: 2,
      ...base,
      weekly_days: [...new Set(days.map(zoomWeekday))].sort((a, b) => a - b).join(','),
    };
  }

  // Monthly: on a day of the month, or on the nth weekday.
  if (rule.byMonthDay) {
    if (rule.byDay || rule.bySetPos || rule.byMonthDay.length !== 1) {
      throw unsupported('a monthly rule on several days');
    }
    const [day] = rule.byMonthDay;
    if (day !== local.day)
      throw unsupported('a monthly rule on a day other than the first meeting');
    return { type: 3, ...base, monthly_day: day };
  }
  if (!rule.byDay) return { type: 3, ...base, monthly_day: local.day };
  const [only, ...more] = rule.byDay;
  if (!only || more.length > 0) throw unsupported('a monthly rule on several weekdays');
  const position = only.n ?? (rule.bySetPos?.length === 1 ? rule.bySetPos[0] : undefined);
  if (
    position === undefined ||
    (only.n !== undefined && rule.bySetPos) ||
    !NTH_WEEKS.includes(position)
  ) {
    throw unsupported('this monthly rule');
  }
  if (only.weekday !== weekday || !isNthWeekday(local, position)) {
    throw unsupported('a monthly rule whose weekday leaves out the first meeting');
  }
  return { type: 3, ...base, monthly_week: position, monthly_week_day: zoomWeekday(only.weekday) };
}

/**
 * RFC 5545 lines for a Zoom recurrence, with an EXDATE for each meeting deleted from the
 * series. Returns `undefined` for a pattern calsdk does not know.
 */
export function fromZoomRecurrence(
  recurrence: ZoomRecurrence,
  deleted: number[],
): string[] | undefined {
  const rule: Partial<RRule> = {};
  if (recurrence.type === 1) rule.freq = 'DAILY';
  else if (recurrence.type === 2) {
    rule.freq = 'WEEKLY';
    const days = (recurrence.weekly_days ?? '').split(',').map((day) => WEEKDAYS[Number(day) - 1]);
    if (days.length === 0 || days.some((day) => day === undefined)) return undefined;
    rule.byDay = days.flatMap((weekday) => (weekday ? [{ weekday }] : []));
  } else if (recurrence.type === 3) {
    rule.freq = 'MONTHLY';
    const weekday = WEEKDAYS[(recurrence.monthly_week_day ?? 0) - 1];
    if (recurrence.monthly_week && weekday) {
      rule.byDay = [{ weekday, n: recurrence.monthly_week }];
    } else if (recurrence.monthly_day) {
      rule.byMonthDay = [recurrence.monthly_day];
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
  if (recurrence.repeat_interval && recurrence.repeat_interval > 1) {
    rule.interval = recurrence.repeat_interval;
  }
  if (recurrence.end_date_time)
    rule.until = instantToICalDate(Date.parse(recurrence.end_date_time));
  else if (recurrence.end_times) rule.count = recurrence.end_times;
  return [
    formatRRule({ freq: rule.freq, ...rule }),
    ...formatExdates(deleted.map(instantToICalDate)),
  ];
}

/** Whether `local` is the `position`th (or last, for `-1`) of its weekday in its month. */
function isNthWeekday(local: { year: number; month: number; day: number }, position: number) {
  if (position > 0) return Math.ceil(local.day / 7) === position;
  const daysInMonth = new Date(Date.UTC(local.year, local.month, 0)).getUTCDate();
  return local.day + 7 > daysInMonth;
}

/** The instant of an iCalendar date, read in `timeZone`. Dates are their start, or end. */
function instantOf(value: ICalDate, timeZone: string, endOfDay = false): number {
  if (value.type === 'date') {
    const local = parseLocalDateTime(value.date);
    if (!local) throw unsupported(`the date "${value.date}"`);
    return localToInstant(
      endOfDay ? { ...local, hour: 23, minute: 59, second: 59 } : local,
      timeZone,
    );
  }
  const local = parseLocalDateTime(value.local);
  if (!local) throw unsupported(`the date "${value.local}"`);
  return localToInstant(local, value.timeZone ?? timeZone);
}

/** `2030-01-07T15:00:00Z`: Zoom takes UTC times without milliseconds. */
export function isoSeconds(instant: number): string {
  return new Date(instant).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
