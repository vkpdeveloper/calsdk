import { InvalidResponseDataError } from '@calsdk/provider';
import type { CalendarEvent, CallSettings, ResultMetadata, TimeInput } from './types';
import { resultMetadata, runCall } from './util/prepare-call';
import { requireId, toTimeRange, validatePageSize } from './util/validate';

export type ListEventsOptions = CallSettings & {
  /** Defaults to `'primary'`, the user's default calendar. */
  calendarId?: string;
  /** Start of the window (inclusive). Events ending after it are returned. */
  timeMin: TimeInput;
  /** End of the window (exclusive). Events starting before it are returned. */
  timeMax: TimeInput;
  /**
   * `true` (default): recurring events come back as their individual
   * occurrences and exceptions, ordered by start. `false`: the series masters.
   */
  expandRecurring?: boolean;
  /** Free-text search. Check `calendar.capabilities.events.search`. */
  query?: string;
  /** Upper bound on events per page. */
  pageSize?: number;
  /** `nextPageToken` from the previous page. */
  pageToken?: string;
};
export type ListEventsResult = ResultMetadata & {
  events: CalendarEvent[];
  /** Pass as `pageToken` to get the next page. Missing on the last page. */
  nextPageToken?: string;
};

function prepare(options: Omit<ListEventsOptions, keyof CallSettings>) {
  return {
    calendarId: requireId(options.calendarId ?? 'primary', 'calendarId'),
    ...toTimeRange(options.timeMin, options.timeMax),
    expandRecurring: options.expandRecurring ?? true,
    query: options.query,
    pageSize: validatePageSize(options.pageSize),
  };
}

/**
 * Lists one page of events in a time window. Use `iterateEvents` to walk all pages.
 *
 * @example
 * const { events, nextPageToken } = await listEvents({
 *   calendar,
 *   timeMin: new Date(),
 *   timeMax: '2026-12-31T00:00:00Z',
 * });
 */
export async function listEvents(options: ListEventsOptions): Promise<ListEventsResult> {
  const request = prepare(options);
  const result = await runCall(options, 'listEvents', 'retryable', (callOptions) =>
    options.calendar.doListEvents({ ...callOptions, ...request, pageToken: options.pageToken }),
  );
  return { events: result.events, nextPageToken: result.nextPageToken, ...resultMetadata(result) };
}

/**
 * Yields every event in a time window, fetching pages as needed. Warnings are
 * reported through `globalThis.CALSDK_WARNINGS`.
 *
 * @example
 * for await (const event of iterateEvents({ calendar, timeMin, timeMax })) {
 *   console.log(event.title);
 * }
 */
export async function* iterateEvents(
  options: Omit<ListEventsOptions, 'pageToken'>,
): AsyncGenerator<CalendarEvent, void, undefined> {
  const request = prepare(options);
  const seen = new Set<string>();
  let pageToken: string | undefined;
  do {
    const token = pageToken;
    const result = await runCall(options, 'iterateEvents', 'retryable', (callOptions) =>
      options.calendar.doListEvents({ ...callOptions, ...request, pageToken: token }),
    );
    yield* result.events;
    pageToken = result.nextPageToken;
    if (pageToken !== undefined) {
      // A provider returning the same token twice would loop forever.
      if (seen.has(pageToken)) {
        throw new InvalidResponseDataError({
          data: pageToken,
          message: `Provider "${options.calendar.provider}" returned the same page token twice. This is a provider bug.`,
        });
      }
      seen.add(pageToken);
    }
  } while (pageToken !== undefined);
}
