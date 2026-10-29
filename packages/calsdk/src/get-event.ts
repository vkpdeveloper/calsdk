import type { CalendarEvent, CallSettings, ResultMetadata } from './types';
import { resultMetadata, runCall } from './util/prepare-call';
import { requireId } from './util/validate';

export type GetEventOptions = CallSettings & {
  /** Defaults to `'primary'`, the user's default calendar. */
  calendarId?: string;
  /** A single, series, occurrence or exception id. */
  eventId: string;
};
export type GetEventResult = ResultMetadata & { event: CalendarEvent };

/**
 * Fetches one event. Throws `NotFoundError` when it does not exist.
 *
 * @example
 * const { event } = await getEvent({ calendar, eventId });
 */
export async function getEvent(options: GetEventOptions): Promise<GetEventResult> {
  const calendarId = requireId(options.calendarId ?? 'primary', 'calendarId');
  const eventId = requireId(options.eventId, 'eventId');
  const result = await runCall(options, 'getEvent', 'retryable', (callOptions) =>
    options.calendar.doGetEvent({ ...callOptions, calendarId, eventId }),
  );
  return { event: result.event, ...resultMetadata(result) };
}
