import type { CalendarEvent, CallSettings, EventInput, ResultMetadata, SendUpdates } from './types';
import { resultMetadata, runCall } from './util/prepare-call';
import { requireId, validateEventInput } from './util/validate';

export type CreateEventOptions = CallSettings & {
  /** Defaults to `'primary'`, the user's default calendar. */
  calendarId?: string;
  event: EventInput;
  /** Whether attendees get an invitation. Provider default when omitted. */
  sendUpdates?: SendUpdates;
};
export type CreateEventResult = ResultMetadata & { event: CalendarEvent };

/**
 * Creates an event and returns it as stored by the provider.
 *
 * Only rate-limited attempts are retried: retrying after a server error could
 * create the event twice.
 *
 * @example
 * const { event } = await createEvent({
 *   calendar,
 *   event: {
 *     title: 'Design review',
 *     start: { dateTime: '2026-11-03T10:00:00', timeZone: 'Asia/Kolkata' },
 *     end: { dateTime: '2026-11-03T10:30:00', timeZone: 'Asia/Kolkata' },
 *   },
 * });
 */
export async function createEvent(options: CreateEventOptions): Promise<CreateEventResult> {
  const calendarId = requireId(options.calendarId ?? 'primary', 'calendarId');
  const event = validateEventInput(options.event);
  const result = await runCall(options, 'createEvent', 'rateLimitOnly', (callOptions) =>
    options.calendar.doCreateEvent({
      ...callOptions,
      calendarId,
      event,
      sendUpdates: options.sendUpdates,
    }),
  );
  return { event: result.event, ...resultMetadata(result) };
}
