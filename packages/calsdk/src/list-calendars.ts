import type { Calendar, CalendarProvider, CallSettings, ResultMetadata } from './types';
import { resultMetadata, runCall } from './util/prepare-call';

export type ListCalendarsOptions<C extends CalendarProvider = CalendarProvider> = CallSettings<
  C,
  'listCalendars'
>;
export type ListCalendarsResult = ResultMetadata & { calendars: Calendar[] };

/**
 * Lists the calendars the user can see. Exactly one has `isPrimary: true`.
 *
 * @example
 * const { calendars } = await listCalendars({ calendar: google({ accessToken }) });
 */
export async function listCalendars<C extends CalendarProvider>(
  options: ListCalendarsOptions<C>,
): Promise<ListCalendarsResult>;
export async function listCalendars(options: ListCalendarsOptions): Promise<ListCalendarsResult> {
  const result = await runCall(options, 'listCalendars', 'retryable', (callOptions) =>
    options.calendar.doListCalendars(callOptions),
  );
  return { calendars: result.calendars, ...resultMetadata(result) };
}
