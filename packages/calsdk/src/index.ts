export {
  APICallError,
  AuthenticationError,
  CalsdkError,
  ConflictError,
  InvalidArgumentError,
  InvalidResponseDataError,
  NoSuchProviderVersionError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  SyncCursorExpiredError,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
export {
  type CreateEventOptions,
  type CreateEventResult,
  createEvent,
} from './create-event';
export {
  type DeleteEventOptions,
  type DeleteEventResult,
  deleteEvent,
} from './delete-event';
export { FreeBusyUnavailableError } from './errors/free-busy-unavailable-error';
export {
  type FindFreeTimeOptions,
  type FindFreeTimeResult,
  type FreeSlot,
  findFreeTime,
  type WorkingHours,
} from './find-free-time';
export { type GetEventOptions, type GetEventResult, getEvent } from './get-event';
export {
  type FreeBusyCalendar,
  type GetFreeBusyOptions,
  type GetFreeBusyResult,
  getFreeBusy,
} from './get-free-busy';
export {
  type ListCalendarsOptions,
  type ListCalendarsResult,
  listCalendars,
} from './list-calendars';
export {
  iterateEvents,
  type ListEventsOptions,
  type ListEventsResult,
  listEvents,
} from './list-events';
export {
  type SyncEventsOptions,
  type SyncEventsPageResult,
  type SyncEventsResult,
  syncEvents,
} from './sync-events';
export type * from './types';
export {
  type UpdateEventOptions,
  type UpdateEventResult,
  updateEvent,
} from './update-event';
export type { WarningsSetting } from './util/log-warnings';
