import { NotFoundError } from '@calsdk/provider';
import type {
  CalendarProvider,
  CallSettings,
  ResultMetadata,
  SendUpdates,
  UpdateScope,
} from './types';
import { resultMetadata, runCall } from './util/prepare-call';
import { requireId } from './util/validate';

export type DeleteEventOptions<C extends CalendarProvider = CalendarProvider> = CallSettings<
  C,
  'deleteEvent'
> & {
  /** Defaults to `'primary'`, the user's default calendar. */
  calendarId?: string;
  eventId: string;
  /**
   * For occurrence and exception ids: delete only this instance (`'this'`, default),
   * the whole series (`'all'`) or this and later instances (`'thisAndFollowing'`).
   */
  scope?: UpdateScope;
  /** Only delete if the event's `etag` still matches. Otherwise throws `ConflictError`. */
  ifMatch?: string;
  sendUpdates?: SendUpdates;
};
export type DeleteEventResult = ResultMetadata;

/**
 * Deletes an event. Throws `NotFoundError` if it does not exist.
 *
 * @example
 * await deleteEvent({ calendar, eventId });
 */
export async function deleteEvent<C extends CalendarProvider>(
  options: DeleteEventOptions<C>,
): Promise<DeleteEventResult>;
export async function deleteEvent(options: DeleteEventOptions): Promise<DeleteEventResult> {
  const calendarId = requireId(options.calendarId ?? 'primary', 'calendarId');
  const eventId = requireId(options.eventId, 'eventId');
  const result = await runCall(
    options,
    'deleteEvent',
    'retryable',
    async (callOptions, attempt) => {
      try {
        return await options.calendar.doDeleteEvent({
          ...callOptions,
          calendarId,
          eventId,
          scope: options.scope,
          ifMatch: options.ifMatch,
          sendUpdates: options.sendUpdates,
        });
      } catch (error) {
        // An earlier attempt may have deleted the event before its response was lost.
        // A missing calendar is a real error either way.
        if (attempt > 0 && NotFoundError.isInstance(error) && error.resource === 'event') {
          return { warnings: [] };
        }
        throw error;
      }
    },
  );
  return resultMetadata(result);
}
