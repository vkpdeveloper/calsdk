import type {
  CalendarProvider,
  CallSettings,
  EventOf,
  EventPatch,
  ResultMetadata,
  SendUpdates,
  UpdateScope,
} from './types';
import { resultMetadata, runCall } from './util/prepare-call';
import { requireId, validateEventPatch } from './util/validate';

export type UpdateEventOptions<C extends CalendarProvider = CalendarProvider> = CallSettings<
  C,
  'updateEvent'
> & {
  /** Defaults to `'primary'`, the user's default calendar. */
  calendarId?: string;
  eventId: string;
  /** Fields to change. Omitted fields stay as they are, `null` clears a field. */
  patch: EventPatch;
  /**
   * For occurrence and exception ids: change only this instance (`'this'`, default),
   * the whole series (`'all'`) or this and later instances (`'thisAndFollowing'`).
   */
  scope?: UpdateScope;
  /** Only update if the event's `etag` still matches. Otherwise throws `ConflictError`. */
  ifMatch?: string;
  sendUpdates?: SendUpdates;
};
export type UpdateEventResult<C extends CalendarProvider = CalendarProvider> = ResultMetadata & {
  event: EventOf<C>;
};

/**
 * Applies a partial update to an event.
 *
 * @example
 * const { event } = await updateEvent({
 *   calendar,
 *   eventId,
 *   patch: { title: 'Moved to Friday', location: null },
 *   ifMatch: previous.etag,
 * });
 */
export async function updateEvent<C extends CalendarProvider>(
  options: UpdateEventOptions<C>,
): Promise<UpdateEventResult<C>>;
export async function updateEvent(options: UpdateEventOptions): Promise<UpdateEventResult> {
  const calendarId = requireId(options.calendarId ?? 'primary', 'calendarId');
  const eventId = requireId(options.eventId, 'eventId');
  const patch = validateEventPatch(options.patch);
  const result = await runCall(options, 'updateEvent', 'retryable', (callOptions) =>
    options.calendar.doUpdateEvent({
      ...callOptions,
      calendarId,
      eventId,
      patch,
      scope: options.scope,
      ifMatch: options.ifMatch,
      sendUpdates: options.sendUpdates,
    }),
  );
  return { event: result.event, ...resultMetadata(result) };
}
