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
  if (!/^\d+$/.test(value) || number < 1 || !Number.isSafeInteger(number)) {
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
    Number(day) > daysInMonth(Number(year), Number(month)) ||
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

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Formats an `ICalDate` value without parameters: `20261103` or `20261103T100000[Z]`.
 * Throws `InvalidArgumentError` for values that are not dates, so nothing can be injected
 * into the surrounding line.
 */
export function formatICalDate(value: ICalDate): string {
  const pattern =
    value.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  const text = value.type === 'date' ? value.date : value.local;
  if (!pattern.test(text)) throw invalid(`"${text}" is not a valid ${value.type}.`);
  const compact = text.replaceAll('-', '').replaceAll(':', '');
  return value.type === 'date-time' && value.timeZone === 'UTC' ? `${compact}Z` : compact;
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
  assertSingleLine(line);
  const value = line.replace(/^RRULE:/i, '').trim();
  const parts = new Map<string, string>();
  for (const part of value.split(';')) {
    if (part === '') continue;
    const match = /^([A-Za-z-]+)=([^=]+)$/.exec(part);
    const name = match?.[1]?.toUpperCase();
    const partValue = match?.[2]?.toUpperCase();
    if (!name || !partValue) throw invalid(`Malformed RRULE part "${part}".`);
    if (parts.has(name)) throw invalid(`RRULE part ${name} appears more than once.`);
    parts.set(name, partValue);
  }

  const freq = parts.get('FREQ');
  if (!freq || !FREQUENCIES.has(freq as RRule['freq'])) {
    throw invalid(`RRULE needs FREQ set to one of ${[...FREQUENCIES].join(', ')}.`);
  }
  const rule: RRule = { freq: freq as RRule['freq'] };
  const other: Record<string, string> = {};

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
        other[name] = partValue;
    }
  }
  if (Object.keys(other).length > 0) rule.other = other;

  if (rule.count !== undefined && rule.until !== undefined) {
    throw invalid('RRULE cannot have both COUNT and UNTIL.');
  }
  // RFC 5545 3.3.10: numbered BYDAY needs MONTHLY or YEARLY, BYMONTHDAY cannot be WEEKLY.
  if (
    rule.byDay?.some((day) => day.n !== undefined) &&
    !['MONTHLY', 'YEARLY'].includes(rule.freq)
  ) {
    throw invalid('Numbered BYDAY values such as 2MO need FREQ=MONTHLY or FREQ=YEARLY.');
  }
  if (rule.byMonthDay && rule.freq === 'WEEKLY') {
    throw invalid('BYMONTHDAY cannot be used with FREQ=WEEKLY.');
  }
  return rule;
}

function assertSingleLine(line: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  if (/[\x00-\x1f\x7f]/.test(line)) {
    throw invalid('Recurrence lines cannot contain line breaks or control characters.');
  }
}

/** Parameter values and RRULE parts are written raw, so they cannot contain delimiters. */
function assertSafeValue(kind: string, value: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  if (value === '' || /[\x00-\x1f\x7f;:,="]/.test(value)) {
    throw invalid(`${kind} "${value}" contains characters that are not allowed.`);
  }
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
  for (const [name, value] of Object.entries(rule.other ?? {})) {
    if (!/^[A-Z-]+$/.test(name)) throw invalid(`RRULE part name "${name}" is not allowed.`);
    if (value.split(',').some((item) => item === '' || /[^A-Za-z0-9+-]/.test(item))) {
      throw invalid(`RRULE part ${name} has a value that is not allowed.`);
    }
    parts.push(`${name}=${value}`);
  }
  return `RRULE:${parts.join(';')}`;
}

function parseDateListLine(line: string): ICalDate[] {
  const separator = line.indexOf(':');
  if (separator === -1) throw invalid(`Malformed recurrence line "${line}".`);
  const params = line.slice(0, separator).split(';').slice(1);
  const timeZone = params
    .find((param) => param.toUpperCase().startsWith('TZID='))
    ?.slice('TZID='.length)
    .replace(/^"(.*)"$/, '$1');
  return line
    .slice(separator + 1)
    .split(',')
    .map((value) => parseICalDate(value.trim(), timeZone));
}

/**
 * Splits RFC 5545 recurrence lines (`EventV1.recurrence`) into the rule and its
 * exception dates. Throws `InvalidArgumentError` for malformed lines, line breaks or
 * more than one `RRULE`. `RDATE;VALUE=PERIOD` lines are kept in `other`.
 */
export function parseRecurrence(lines: readonly string[]): ParsedRecurrence {
  const result: ParsedRecurrence = { exdates: [], rdates: [], other: [] };
  for (const line of lines) {
    assertSingleLine(line);
    const name = line.split(/[;:]/, 1)[0]?.toUpperCase();
    if (name === 'RRULE') {
      if (result.rrule) throw invalid('Only one RRULE line is supported.');
      result.rrule = parseRRule(line);
    } else if (name === 'EXDATE') {
      result.exdates.push(...parseDateListLine(line));
    } else if (name === 'RDATE' && !/;VALUE=PERIOD[;:]/i.test(line)) {
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
    let params = '';
    if (date.type === 'date') params = ';VALUE=DATE';
    else if (date.timeZone && date.timeZone !== 'UTC') {
      assertSafeValue('TZID', date.timeZone);
      params = `;TZID=${date.timeZone}`;
    }
    const values = groups.get(params) ?? [];
    values.push(formatICalDate(date));
    groups.set(params, values);
  }
  return [...groups].map(([params, values]) => `EXDATE${params}:${values.join(',')}`);
}
