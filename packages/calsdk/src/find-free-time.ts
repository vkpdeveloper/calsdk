import { InvalidArgumentError } from '@calsdk/provider';
import { getTimeZoneOffset, isValidTimeZone } from '@calsdk/provider-utils';
import { FreeBusyUnavailableError } from './errors/free-busy-unavailable-error';
import { getFreeBusy, mergeBusy } from './get-free-busy';
import type { CallSettings, TimeInput, Warning } from './types';
import { toTimeRange } from './util/validate';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

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
  /**
   * Every calendar that must be free, grouped by provider. `calendarIds` defaults to
   * `['primary']`. `headers` and `providerOptions` apply to that provider's requests.
   */
  calendars: (Pick<CallSettings, 'calendar' | 'headers' | 'providerOptions'> & {
    calendarIds?: string[];
  })[];
  timeMin: TimeInput;
  timeMax: TimeInput;
  /** Meeting length in minutes. */
  duration: number;
  /** Only return slots inside these hours. Omit to search the whole window. */
  workingHours?: WorkingHours;
  /** Minutes between slot starts, aligned to the hour (in `workingHours.timeZone`, else UTC). Defaults to 15. */
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
  // Validated before any request is made.
  const slotStarts = options.workingHours ? workingHoursOf(options.workingHours) : epochGridStarts;

  const results = await Promise.all(
    options.calendars.map(({ calendar, calendarIds, headers, providerOptions }) =>
      getFreeBusy({
        calendar,
        calendarIds,
        headers,
        providerOptions,
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
  for (const start of slotStarts(bounds, duration, interval)) {
    const end = start + duration;
    while (next < blocks.length && (blocks[next]?.end ?? 0) <= start) next++;
    const block = blocks[next];
    if (block && block.start < end) continue;
    slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
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

type Bounds = { start: number; end: number };

/** Slot starts on a grid counted from the Unix epoch, so in UTC. */
function* epochGridStarts(bounds: Bounds, duration: number, interval: number) {
  for (
    let start = Math.ceil(bounds.start / interval) * interval;
    start + duration <= bounds.end;
    start += interval
  ) {
    yield start;
  }
}

/**
 * Validates working hours and returns a generator of slot starts inside them, in order.
 *
 * Time is split into stretches where the zone's UTC offset does not change. Inside one,
 * local time is just `instant + offset`, so slots are placed on the local wall clock:
 * the grid stays on the hour after any DST change, an hour skipped by a gap gets no
 * slots, and both runs of a repeated hour get them.
 */
function workingHoursOf(hours: WorkingHours) {
  const { timeZone } = hours;
  if (!isValidTimeZone(timeZone)) {
    throw new InvalidArgumentError({
      argument: 'workingHours.timeZone',
      message: 'Expected an IANA time zone such as "Asia/Kolkata".',
    });
  }
  const dayStart = clockTime(hours.start, 'workingHours.start') * MINUTE_MS;
  const dayEnd = clockTime(hours.end, 'workingHours.end') * MINUTE_MS;
  if (dayEnd <= dayStart) {
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

  const offsetAt = (instant: number) => getTimeZoneOffset(instant, timeZone);

  /** The first instant in `[from, to)` whose offset is not `offset`, or `to`. */
  const nextChange = (from: number, to: number, offset: number) => {
    // Offsets can change and change back within a long range, so look one day at a time;
    // zones change offset at most once a day.
    for (let low = from; low < to; low += DAY_MS) {
      if (offsetAt(low) !== offset) return low;
      let high = Math.min(low + DAY_MS, to) - 1;
      if (offsetAt(high) === offset) continue;
      // Binary search for the first instant with another offset.
      let same = low;
      while (high - same > 1) {
        const middle = Math.floor((same + high) / 2);
        if (offsetAt(middle) === offset) same = middle;
        else high = middle;
      }
      return high;
    }
    return to;
  };

  /** Splits `[from, to)` into stretches with one UTC offset each. */
  const stretches = (from: number, to: number) => {
    const result: { start: number; end: number; offset: number }[] = [];
    for (let start = from; start < to; ) {
      const offset = offsetAt(start);
      const end = nextChange(start, to, offset);
      result.push({ start, end, offset });
      start = end;
    }
    return result;
  };

  // Local days are counted from 1970-01-01, a Thursday.
  const localDay = (instant: number, offset: number) => Math.floor((instant + offset) / DAY_MS);

  /** Whether every part of the slot falls inside working hours on one local day. */
  const fits = (slotStart: number, slotEnd: number) => {
    const day = localDay(slotStart, offsetAt(slotStart));
    return stretches(slotStart, slotEnd).every(({ start, end, offset }) => {
      const last = end - 1;
      return (
        localDay(start, offset) === day &&
        localDay(last, offset) === day &&
        start + offset - day * DAY_MS >= dayStart &&
        last + offset - day * DAY_MS < dayEnd
      );
    });
  };

  return function* (bounds: Bounds, duration: number, interval: number) {
    // A slot inside working hours lasts at most their span plus a fold, which is under a
    // day. Longer durations never fit, and checking each candidate would scan all of it.
    if (duration > dayEnd - dayStart + DAY_MS) return;
    for (const stretch of stretches(bounds.start, bounds.end)) {
      const lastDay = localDay(stretch.end - 1, stretch.offset);
      for (let day = localDay(stretch.start, stretch.offset); day <= lastDay; day++) {
        if (!days.has((((day + 4) % 7) + 7) % 7)) continue;
        // Candidates on the local grid from midnight. Across a fold a slot can last longer
        // than its wall-clock span, so `fits` decides where it ends.
        for (
          let local = Math.ceil(dayStart / interval) * interval;
          local < dayEnd;
          local += interval
        ) {
          const start = day * DAY_MS + local - stretch.offset;
          if (start < stretch.start || start < bounds.start) continue;
          if (start >= stretch.end) break;
          if (start + duration > bounds.end) return;
          if (fits(start, start + duration)) yield start;
        }
      }
    }
  };
}

/** Minutes since midnight for `'HH:mm'`. */
function clockTime(value: string, argument: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new InvalidArgumentError({ argument, message: 'Expected a time such as "09:00".' });
  }
  return Number(match[1]) * 60 + Number(match[2]);
}
