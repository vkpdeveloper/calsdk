import type { CalendarProvider, CallSettings, EventOf, ResultMetadata } from './types';
import { resultMetadata, runCall } from './util/prepare-call';
import { requireId } from './util/validate';

export type GetEventOptions<C extends CalendarProvider = CalendarProvider> = CallSettings<
  C,
  'getEvent'
> & {
  /** Defaults to `'primary'`, the user's default calendar. */
  calendarId?: string;
  /** A single, series, occurrence or exception id. */
  eventId: string;
};
export type GetEventResult<C extends CalendarProvider = CalendarProvider> = ResultMetadata & {
  event: EventOf<C>;
};

/**
 * Fetches one event. Throws `NotFoundError` when it does not exist.
 *
 * @example
 * const { event } = await getEvent({ calendar, eventId });
 */
export async function getEvent<C extends CalendarProvider>(
  options: GetEventOptions<C>,
): Promise<GetEventResult<C>>;
export async function getEvent(options: GetEventOptions): Promise<GetEventResult> {
  const calendarId = requireId(options.calendarId ?? 'primary', 'calendarId');
  const eventId = requireId(options.eventId, 'eventId');
  const result = await runCall(options, 'getEvent', 'retryable', (callOptions) =>
    options.calendar.doGetEvent({ ...callOptions, calendarId, eventId }),
  );
  return { event: result.event, ...resultMetadata(result) };
}
