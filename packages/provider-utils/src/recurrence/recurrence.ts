import { InvalidArgumentError } from '@calsdk/provider';
import { formatLocalDate, formatLocalDateTime, instantToLocal } from '../time/zoned-time';

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

/** Weekdays in `Date.getUTCDay()` order (Sunday first). */
export const WEEKDAYS: readonly Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** A parsed RFC 5545 `RRULE`. Only the parts calsdk providers use are modeled. */
export type RRule = {
  freq: 'SECONDLY' | 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval?: number;
  count?: number;
  until?: ICalDate;
  /** `n` selects the nth weekday of the month or year: `{ weekday: 'MO', n: -1 }` is the last Monday. */
  byDay?: { weekday: Weekday; n?: number }[];
  byMonthDay?: number[];
  byMonth?: number[];
  bySetPos?: number[];
  weekStart?: Weekday;
  /** Parts not modeled above (`BYHOUR`, `BYYEARDAY`, ...), kept verbatim. Providers that cannot honor them must say so. */
  other?: Record<string, string>;
};

/**
 * A date or date-time value from an iCalendar property.
 *
 * - `date`: `'YYYY-MM-DD'`.
 * - `date-time`: wall-clock `'YYYY-MM-DDTHH:mm:ss'` in `timeZone`. `'UTC'` for
 *   values ending in `Z`, the `TZID` parameter otherwise, `undefined` for floating times.
 */
export type ICalDate =
  | { type: 'date'; date: string }
  | { type: 'date-time'; local: string; timeZone?: string };

export type ParsedRecurrence = {
  rrule?: RRule;
  exdates: ICalDate[];
  rdates: ICalDate[];
  /** Lines calsdk does not interpret, such as `EXRULE`. */
  other: string[];
};

const FREQUENCIES = new Set<RRule['freq']>([
  'SECONDLY',
  'MINUTELY',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
]);

function invalid(message: string): InvalidArgumentError {
  return new InvalidArgumentError({ argument: 'recurrence', message });
}

function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

function parseIntegerList(name: string, value: string, min: number, max: number): number[] {
  return value.split(',').map((item) => {
    const number = Number(item);
    if (!Number.isInteger(number) || number === 0 || number < min || number > max) {
      throw invalid(
        `${name} value "${item}" must be a non-zero integer between ${min} and ${max}.`,
      );
    }
    return number;
  });
}

function parsePositiveInteger(name: string, value: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < 1) {
    throw invalid(`${name} must be a positive integer, got "${value}".`);
  }
  return number;
}

/**
 * Parses an iCalendar date or date-time value: `20261103`, `20261103T100000`,
 * `20261103T100000Z`. `timeZone` is the property's `TZID` parameter.
 */
export function parseICalDate(value: string, timeZone?: string): ICalDate {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!match) throw invalid(`"${value}" is not an iCalendar date or date-time.`);
  const [, year, month, day, hour, minute, second, utc] = match;
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > 31 ||
    Number(hour ?? 0) > 23 ||
    Number(minute ?? 0) > 59 ||
    Number(second ?? 0) > 60
  ) {
    throw invalid(`"${value}" is not a valid iCalendar date or date-time.`);
  }
  const date = `${year}-${month}-${day}`;
  if (hour === undefined) return { type: 'date', date };
  return {
    type: 'date-time',
    local: `${date}T${hour}:${minute}:${second}`,
    timeZone: utc ? 'UTC' : timeZone,
  };
}

/** Formats an `ICalDate` value without parameters: `20261103` or `20261103T100000[Z]`. */
export function formatICalDate(value: ICalDate): string {
  if (value.type === 'date') return value.date.replaceAll('-', '');
  const compact = value.local.replaceAll('-', '').replaceAll(':', '');
  return value.timeZone === 'UTC' ? `${compact}Z` : compact;
}

/** The UTC date-time form of an instant, e.g. for `UNTIL`: `20261231T235959Z`. */
export function instantToICalDate(instant: number): ICalDate {
  return {
    type: 'date-time',
    local: formatLocalDateTime(instantToLocal(instant, 'UTC')),
    timeZone: 'UTC',
  };
}

/** The date form of an instant in a zone, e.g. for all-day `UNTIL`: `20261231`. */
export function instantToICalDateOnly(instant: number, timeZone: string): ICalDate {
  return { type: 'date', date: formatLocalDate(instantToLocal(instant, timeZone)) };
}

/** Parses an `RRULE` line. The `RRULE:` prefix is optional. */
export function parseRRule(line: string): RRule {
  const value = line.replace(/^RRULE:/i, '').trim();
  const parts = new Map<string, string>();
  for (const part of value.split(';')) {
    if (part === '') continue;
    const [name, partValue] = part.split('=', 2);
    if (!name || partValue === undefined) throw invalid(`Malformed RRULE part "${part}".`);
    parts.set(name.toUpperCase(), partValue.toUpperCase());
  }

  const freq = parts.get('FREQ');
  if (!freq || !FREQUENCIES.has(freq as RRule['freq'])) {
    throw invalid(`RRULE needs FREQ set to one of ${[...FREQUENCIES].join(', ')}.`);
  }
  const rule: RRule = { freq: freq as RRule['freq'] };

  for (const [name, partValue] of parts) {
    switch (name) {
      case 'FREQ':
        break;
      case 'INTERVAL':
        rule.interval = parsePositiveInteger('INTERVAL', partValue);
        break;
      case 'COUNT':
        rule.count = parsePositiveInteger('COUNT', partValue);
        break;
      case 'UNTIL':
        rule.until = parseICalDate(partValue);
        break;
      case 'BYDAY':
        rule.byDay = partValue.split(',').map((item) => {
          const match = /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(item);
          const weekday = match?.[2];
          const n = match?.[1] !== undefined ? Number(match[1]) : undefined;
          if (!weekday || !isWeekday(weekday) || n === 0 || (n !== undefined && Math.abs(n) > 53)) {
            throw invalid(`BYDAY value "${item}" is not a weekday like MO, 2TU or -1FR.`);
          }
          return n === undefined ? { weekday } : { weekday, n };
        });
        break;
      case 'BYMONTHDAY':
        rule.byMonthDay = parseIntegerList('BYMONTHDAY', partValue, -31, 31);
        break;
      case 'BYMONTH':
        rule.byMonth = parseIntegerList('BYMONTH', partValue, 1, 12);
        break;
      case 'BYSETPOS':
        rule.bySetPos = parseIntegerList('BYSETPOS', partValue, -366, 366);
        break;
      case 'WKST':
        if (!isWeekday(partValue)) throw invalid(`WKST "${partValue}" is not a weekday.`);
        rule.weekStart = partValue;
        break;
      default:
        rule.other = { ...rule.other, [name]: partValue };
    }
  }

  if (rule.count !== undefined && rule.until !== undefined) {
    throw invalid('RRULE cannot have both COUNT and UNTIL.');
  }
  return rule;
}

/** Formats an `RRule` as an `RRULE:` line. */
export function formatRRule(rule: RRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== undefined && rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${formatICalDate(rule.until)}`);
  if (rule.byDay?.length) {
    parts.push(`BYDAY=${rule.byDay.map(({ weekday, n }) => `${n ?? ''}${weekday}`).join(',')}`);
  }
  if (rule.byMonthDay?.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
  if (rule.bySetPos?.length) parts.push(`BYSETPOS=${rule.bySetPos.join(',')}`);
  if (rule.weekStart !== undefined) parts.push(`WKST=${rule.weekStart}`);
  for (const [name, value] of Object.entries(rule.other ?? {})) parts.push(`${name}=${value}`);
  return `RRULE:${parts.join(';')}`;
}

function parseDateListLine(line: string): ICalDate[] {
  const separator = line.indexOf(':');
  if (separator === -1) throw invalid(`Malformed recurrence line "${line}".`);
  const params = line.slice(0, separator).split(';').slice(1);
  const timeZone = params
    .find((param) => param.toUpperCase().startsWith('TZID='))
    ?.slice('TZID='.length);
  return line
    .slice(separator + 1)
    .split(',')
    .map((value) => parseICalDate(value.trim(), timeZone));
}

/**
 * Splits RFC 5545 recurrence lines (`EventV1.recurrence`) into the rule and its
 * exception dates. Throws `InvalidArgumentError` for malformed lines or more than one `RRULE`.
 */
export function parseRecurrence(lines: readonly string[]): ParsedRecurrence {
  const result: ParsedRecurrence = { exdates: [], rdates: [], other: [] };
  for (const line of lines) {
    const name = line.split(/[;:]/, 1)[0]?.toUpperCase();
    if (name === 'RRULE') {
      if (result.rrule) throw invalid('Only one RRULE line is supported.');
      result.rrule = parseRRule(line);
    } else if (name === 'EXDATE') {
      result.exdates.push(...parseDateListLine(line));
    } else if (name === 'RDATE') {
      result.rdates.push(...parseDateListLine(line));
    } else {
      result.other.push(line);
    }
  }
  return result;
}

/**
 * Formats exception dates as one `EXDATE` line per zone and value type.
 *
 * @example
 * formatExdates([{ type: 'date-time', local: '2026-11-10T10:00:00', timeZone: 'Asia/Kolkata' }])
 * // ['EXDATE;TZID=Asia/Kolkata:20261110T100000']
 */
export function formatExdates(dates: readonly ICalDate[]): string[] {
  const groups = new Map<string, string[]>();
  for (const date of dates) {
    const params =
      date.type === 'date'
        ? ';VALUE=DATE'
        : date.timeZone && date.timeZone !== 'UTC'
          ? `;TZID=${date.timeZone}`
          : '';
    groups.set(params, [...(groups.get(params) ?? []), formatICalDate(date)]);
  }
  return [...groups].map(([params, values]) => `EXDATE${params}:${values.join(',')}`);
}
