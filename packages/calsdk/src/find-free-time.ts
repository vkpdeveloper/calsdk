import { InvalidArgumentError } from '@calsdk/provider';
import {
  addDaysToDate,
  formatLocalDate,
  instantToLocal,
  isValidTimeZone,
  localToInstant,
} from '@calsdk/provider-utils';
import { FreeBusyUnavailableError } from './errors/free-busy-unavailable-error';
import { getFreeBusy, mergeBusy } from './get-free-busy';
import type { CalendarProvider, TimeInput, Warning } from './types';
import { toTimeRange } from './util/validate';

const MINUTE_MS = 60_000;

export type WorkingHours = {
  /** `'HH:mm'`, e.g. `'09:00'`. */
  start: string;
  /** `'HH:mm'`, after `start`. Slots end by this time. */
  end: string;
  /** IANA time zone the hours are in, e.g. `'Asia/Kolkata'`. */
  timeZone: string;
  /** Days of the week, `0` (Sunday) to `6` (Saturday). Defaults to Monday to Friday. */
  days?: number[];
};

export type FindFreeTimeOptions = {
  /** Every calendar that must be free, grouped by provider. `calendarIds` defaults to `['primary']`. */
  calendars: { calendar: CalendarProvider; calendarIds?: string[] }[];
  timeMin: TimeInput;
  timeMax: TimeInput;
  /** Meeting length in minutes. */
  duration: number;
  /** Only return slots inside these hours. Omit to search the whole window. */
  workingHours?: WorkingHours;
  /** Minutes between slot starts, aligned to the hour. Defaults to 15. */
  slotInterval?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
};

export type FreeSlot = { start: string; end: string };

export type FindFreeTimeResult = {
  /** Candidate start times, in order. Neighbouring slots overlap when `slotInterval < duration`. */
  slots: FreeSlot[];
  warnings: Warning[];
};

/**
 * Finds times when every listed calendar is free, across providers.
 *
 * @example
 * const { slots } = await findFreeTime({
 *   calendars: [{ calendar: google({ accessToken }) }, { calendar: microsoft({ accessToken }) }],
 *   timeMin: new Date(),
 *   timeMax: new Date(Date.now() + 7 * 86_400_000),
 *   duration: 30,
 *   workingHours: { start: '09:00', end: '18:00', timeZone: 'Asia/Kolkata' },
 * });
 */
export async function findFreeTime(options: FindFreeTimeOptions): Promise<FindFreeTimeResult> {
  const range = toTimeRange(options.timeMin, options.timeMax);
  const bounds = { start: Date.parse(range.timeMin), end: Date.parse(range.timeMax) };
  const duration = positiveInteger(options.duration, 'duration') * MINUTE_MS;
  const interval = positiveInteger(options.slotInterval ?? 15, 'slotInterval') * MINUTE_MS;
  const windows = options.workingHours
    ? workingWindows(options.workingHours, bounds)
    : [{ ...bounds, gridOrigin: 0 }];

  const results = await Promise.all(
    options.calendars.map(({ calendar, calendarIds }) =>
      getFreeBusy({
        calendar,
        calendarIds,
        ...range,
        maxRetries: options.maxRetries,
        abortSignal: options.abortSignal,
      }).then((result) => ({ provider: calendar.provider, result })),
    ),
  );

  const busy: { start: number; end: number }[] = [];
  const warnings: Warning[] = [];
  for (const { provider, result } of results) {
    warnings.push(...result.warnings);
    for (const [calendarId, entry] of Object.entries(result.calendars)) {
      if (entry.error !== undefined) {
        throw new FreeBusyUnavailableError({ provider, calendarId, reason: entry.error });
      }
      for (const block of entry.busy) {
        busy.push({ start: Date.parse(block.start), end: Date.parse(block.end) });
      }
    }
  }
  const blocks = mergeBusy(busy, bounds).map((block) => ({
    start: Date.parse(block.start),
    end: Date.parse(block.end),
  }));

  const slots: FreeSlot[] = [];
  let next = 0; // First busy block that may still overlap a slot.
  for (const window of windows) {
    // Round up to the grid, which starts at the working day's start (or the epoch).
    const offset = (window.start - window.gridOrigin) % interval;
    let start = offset === 0 ? window.start : window.start + interval - offset;
    for (; start + duration <= window.end; start += interval) {
      const end = start + duration;
      while (next < blocks.length && (blocks[next]?.end ?? 0) <= start) next++;
      const block = blocks[next];
      if (block && block.start < end) continue;
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
  }
  return { slots, warnings };
}

function positiveInteger(value: number, argument: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidArgumentError({
      argument,
      message: 'Expected a positive whole number of minutes.',
    });
  }
  return value;
}

/** Working-hour windows inside `bounds`, one per working day, in order. */
function workingWindows(hours: WorkingHours, bounds: { start: number; end: number }) {
  if (!isValidTimeZone(hours.timeZone)) {
    throw new InvalidArgumentError({
      argument: 'workingHours.timeZone',
      message: 'Expected an IANA time zone such as "Asia/Kolkata".',
    });
  }
  const start = clockTime(hours.start, 'workingHours.start');
  const end = clockTime(hours.end, 'workingHours.end');
  if (end <= start) {
    throw new InvalidArgumentError({
      argument: 'workingHours.end',
      message: 'end must be after start.',
    });
  }
  const days = new Set(hours.days ?? [1, 2, 3, 4, 5]);
  if ([...days].some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new InvalidArgumentError({
      argument: 'workingHours.days',
      message: 'Expected days of the week from 0 (Sunday) to 6 (Saturday).',
    });
  }

  const windows: { start: number; end: number; gridOrigin: number }[] = [];
  const lastDate = formatLocalDate(instantToLocal(bounds.end, hours.timeZone));
  for (
    let date = formatLocalDate(instantToLocal(bounds.start, hours.timeZone));
    date <= lastDate;
    date = addDaysToDate(date, 1)
  ) {
    const midnight = new Date(`${date}T00:00:00Z`);
    if (!days.has(midnight.getUTCDay())) continue;
    const at = (minutes: number) =>
      localToInstant(
        {
          year: midnight.getUTCFullYear(),
          month: midnight.getUTCMonth() + 1,
          day: midnight.getUTCDate(),
          hour: Math.floor(minutes / 60),
          minute: minutes % 60,
          second: 0,
        },
        hours.timeZone,
      );
    const dayStart = at(start);
    const window = {
      start: Math.max(dayStart, bounds.start),
      end: Math.min(at(end), bounds.end),
      gridOrigin: dayStart,
    };
    if (window.end > window.start) windows.push(window);
  }
  return windows;
}

/** Minutes since midnight for `'HH:mm'`. */
function clockTime(value: string, argument: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new InvalidArgumentError({ argument, message: 'Expected a time such as "09:00".' });
  }
  return Number(match[1]) * 60 + Number(match[2]);
}
