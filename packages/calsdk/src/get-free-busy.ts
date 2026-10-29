import { NotFoundError, PermissionDeniedError } from '@calsdk/provider';
import { eventTimeToInstant, isAllDay } from '@calsdk/provider-utils';
import { listEventPages } from './list-events';
import type { BusyBlock, CallSettings, ResultMetadata, TimeInput, Warning } from './types';
import { logWarnings } from './util/log-warnings';
import { resultMetadata, runCall } from './util/prepare-call';
import { requireId, toTimeRange } from './util/validate';

export type GetFreeBusyOptions = CallSettings & {
  /** Defaults to `['primary']`. */
  calendarIds?: string[];
  timeMin: TimeInput;
  timeMax: TimeInput;
};

export type FreeBusyCalendar = {
  /** Merged, sorted and clipped to `[timeMin, timeMax)`. */
  busy: BusyBlock[];
  /** Set when this calendar could not be read, e.g. it does not exist or is not shared. */
  error?: string;
};

export type GetFreeBusyResult = ResultMetadata & {
  /** Keyed by the requested calendar id. */
  calendars: Record<string, FreeBusyCalendar>;
};

/**
 * Busy times of one or more calendars.
 *
 * Providers without a free/busy endpoint fall back to listing events: events that
 * show as free or are cancelled are skipped, and a `compatibility` warning is returned.
 *
 * @example
 * const { calendars } = await getFreeBusy({
 *   calendar,
 *   calendarIds: ['primary', 'team@example.com'],
 *   timeMin: new Date(),
 *   timeMax: new Date(Date.now() + 7 * 86_400_000),
 * });
 */
export async function getFreeBusy(options: GetFreeBusyOptions): Promise<GetFreeBusyResult> {
  const range = toTimeRange(options.timeMin, options.timeMax);
  const calendarIds = [...new Set(options.calendarIds ?? ['primary'])];
  for (const [index, id] of calendarIds.entries()) requireId(id, `calendarIds[${index}]`);
  const bounds = { start: Date.parse(range.timeMin), end: Date.parse(range.timeMax) };

  const doFreeBusy = options.calendar.doFreeBusy?.bind(options.calendar);
  if (doFreeBusy) {
    const result = await runCall(options, 'getFreeBusy', 'retryable', (call) =>
      doFreeBusy({ ...call, calendarIds, ...range }),
    );
    // Calendar ids are arbitrary strings (even `__proto__`), so read and build own entries only.
    const calendars = Object.fromEntries(
      calendarIds.map((id): [string, FreeBusyCalendar] => {
        const entry = Object.hasOwn(result.calendars, id) ? result.calendars[id] : undefined;
        if (!entry) return [id, { busy: [], error: 'Missing from the provider response.' }];
        return [
          id,
          {
            busy: mergeBusy(entry.busy.map(toInterval), bounds),
            ...(entry.error !== undefined && { error: entry.error }),
          },
        ];
      }),
    );
    return { calendars, ...resultMetadata(result) };
  }

  const warnings: Warning[] = [
    {
      type: 'compatibility',
      feature: 'freeBusy',
      details: `Provider "${options.calendar.provider}" has no free/busy endpoint, so busy times were computed from events.`,
    },
  ];
  logWarnings(warnings, { provider: options.calendar.provider, operation: 'getFreeBusy' });

  // All-day events block whole days in their calendar's zone, which only listCalendars knows.
  let zones: Promise<Map<string, string>> | undefined;
  const zoneOf = async (calendarId: string) => {
    zones ??= runCall(options, 'getFreeBusy', 'retryable', (call) =>
      options.calendar.doListCalendars(call),
    ).then(({ calendars, warnings: listWarnings }) => {
      warnings.push(...listWarnings);
      const map = new Map<string, string>();
      for (const calendar of calendars) {
        if (calendar.timeZone === undefined) continue;
        map.set(calendar.id, calendar.timeZone);
        if (calendar.isPrimary) map.set('primary', calendar.timeZone);
      }
      return map;
    });
    return (await zones).get(calendarId);
  };
  let unknownZone = false;

  const entries = await Promise.all(
    calendarIds.map(async (calendarId): Promise<[string, FreeBusyCalendar]> => {
      try {
        const intervals: Interval[] = [];
        const listing = { ...options, calendarId, ...range, expandRecurring: true };
        for await (const page of listEventPages(listing, 'getFreeBusy')) {
          warnings.push(...page.warnings);
          for (const event of page.events) {
            if (event.showAs === 'free' || event.status === 'cancelled') continue;
            if (!isAllDay(event.start) || !isAllDay(event.end)) {
              intervals.push({
                start: eventTimeToInstant(event.start, 'UTC'),
                end: eventTimeToInstant(event.end, 'UTC'),
              });
              continue;
            }
            const zone = await zoneOf(calendarId);
            if (zone) {
              intervals.push({
                start: eventTimeToInstant(event.start, zone),
                end: eventTimeToInstant(event.end, zone),
              });
            } else {
              // Without the zone, block the days in every zone (UTC+14 to UTC-12), so the
              // result never shows free time that is actually taken.
              unknownZone = true;
              intervals.push({
                start: Date.parse(event.start.date) - 14 * HOUR_MS,
                end: Date.parse(event.end.date) + 12 * HOUR_MS,
              });
            }
          }
        }
        return [calendarId, { busy: mergeBusy(intervals, bounds) }];
      } catch (error) {
        // One unreadable calendar should not hide the others, like native free/busy.
        if (NotFoundError.isInstance(error) || PermissionDeniedError.isInstance(error)) {
          return [calendarId, { busy: [], error: error.message }];
        }
        throw error;
      }
    }),
  );
  if (unknownZone) {
    const warning: Warning = {
      type: 'compatibility',
      feature: 'allDayEvents',
      details:
        'A calendar has no known time zone, so its all-day events were treated as busy for the whole day in every time zone.',
    };
    warnings.push(warning);
    logWarnings([warning], { provider: options.calendar.provider, operation: 'getFreeBusy' });
  }
  return { calendars: Object.fromEntries(entries), warnings };
}

const HOUR_MS = 3_600_000;

type Interval = { start: number; end: number };

const toInterval = (block: BusyBlock): Interval => ({
  start: Date.parse(block.start),
  end: Date.parse(block.end),
});

/** Sorts, clips to `bounds` and merges overlapping or touching intervals. */
export function mergeBusy(intervals: Interval[], bounds: Interval): BusyBlock[] {
  const clipped = intervals
    .map(({ start, end }) => ({
      start: Math.max(start, bounds.start),
      end: Math.min(end, bounds.end),
    }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);

  const merged: Interval[] = [];
  for (const interval of clipped) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged.map(({ start, end }) => ({
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  }));
}
