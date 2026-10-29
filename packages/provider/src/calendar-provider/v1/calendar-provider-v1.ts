import type { CalendarCapabilitiesV1 } from './capabilities';
import type {
  CreateEventOptionsV1,
  DeleteEventOptionsV1,
  DeleteEventResultV1,
  EventResultV1,
  FreeBusyOptionsV1,
  FreeBusyResultV1,
  GetEventOptionsV1,
  ListCalendarsOptionsV1,
  ListCalendarsResultV1,
  ListEventsOptionsV1,
  ListEventsResultV1,
  SyncEventsOptionsV1,
  SyncEventsResultV1,
  UpdateEventOptionsV1,
} from './operations';
import type {
  ParseWebhookOptionsV1,
  RenewSubscriptionOptionsV1,
  SubscribeOptionsV1,
  SubscriptionV1,
  UnsubscribeOptionsV1,
  WebhookResultV1,
} from './webhooks';

/**
 * The contract every calendar provider implements.
 *
 * Providers are thin, stateless translators between a calendar API and these
 * normalized shapes. Apps do not call `do*` methods directly: they pass the
 * provider to the functions in `calsdk`, which add validation, retries,
 * pagination and fallbacks.
 *
 * Every provider must resolve the calendar id `'primary'` to the user's default calendar.
 */
export type CalendarProviderV1 = {
  /** Contract version. Core rejects providers with a version it does not know. */
  readonly specificationVersion: 'v1';
  /** Stable provider id, e.g. `'google'`. Also the key in `providerOptions` and `providerMetadata`. */
  readonly provider: string;
  readonly capabilities: CalendarCapabilitiesV1;

  doListCalendars(options: ListCalendarsOptionsV1): PromiseLike<ListCalendarsResultV1>;
  doGetEvent(options: GetEventOptionsV1): PromiseLike<EventResultV1>;
  doListEvents(options: ListEventsOptionsV1): PromiseLike<ListEventsResultV1>;
  doCreateEvent(options: CreateEventOptionsV1): PromiseLike<EventResultV1>;
  doUpdateEvent(options: UpdateEventOptionsV1): PromiseLike<EventResultV1>;
  doDeleteEvent(options: DeleteEventOptionsV1): PromiseLike<DeleteEventResultV1>;

  /** Native free/busy. When missing, core computes it from `doListEvents`. */
  doFreeBusy?(options: FreeBusyOptionsV1): PromiseLike<FreeBusyResultV1>;
  /** Incremental sync. When missing, `syncEvents` throws `UnsupportedFunctionalityError`. */
  doSyncEvents?(options: SyncEventsOptionsV1): PromiseLike<SyncEventsResultV1>;

  /** Not implemented by any provider yet. */
  doSubscribe?(options: SubscribeOptionsV1): PromiseLike<SubscriptionV1>;
  /** Not implemented by any provider yet. */
  doRenewSubscription?(options: RenewSubscriptionOptionsV1): PromiseLike<SubscriptionV1>;
  /** Not implemented by any provider yet. */
  doUnsubscribe?(options: UnsubscribeOptionsV1): PromiseLike<void>;
  /** Not implemented by any provider yet. */
  doParseWebhook?(request: Request, options: ParseWebhookOptionsV1): PromiseLike<WebhookResultV1>;
};
