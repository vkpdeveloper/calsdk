import type {
  AttendeeV1,
  BusyBlockV1,
  CalendarCapabilitiesV1,
  CalendarProviderV1,
  CalendarV1,
  EventInputV1,
  EventPatchV1,
  EventTimeV1,
  EventV1,
  ProviderMetadataV1,
  ProviderOptionsV1,
  SendUpdatesV1,
  SyncChangeV1,
  UpdateScopeV1,
  WarningV1,
} from '@calsdk/provider';

/** A calendar provider instance, e.g. `google({ accessToken })` or `mockCalendar()`. */
export type CalendarProvider = CalendarProviderV1;
export type CalendarCapabilities = CalendarCapabilitiesV1;
export type Calendar = CalendarV1;
/** Named `CalendarEvent` to avoid clashing with the DOM `Event` type. */
export type CalendarEvent = EventV1;
export type EventTime = EventTimeV1;
export type EventInput = EventInputV1;
export type EventPatch = EventPatchV1;
export type Attendee = AttendeeV1;
export type BusyBlock = BusyBlockV1;
export type SyncChange = SyncChangeV1;
export type UpdateScope = UpdateScopeV1;
export type SendUpdates = SendUpdatesV1;
export type Warning = WarningV1;
export type ProviderOptions = ProviderOptionsV1;
export type ProviderMetadata = ProviderMetadataV1;

/** Options every calsdk function accepts. */
export type CallSettings = {
  /** The provider to call, e.g. `google({ accessToken })`. */
  calendar: CalendarProvider;
  /**
   * Retries for failures the provider marks as retryable (rate limits, 5xx,
   * network errors), with exponential backoff that honors `Retry-After`. Default 2.
   */
  maxRetries?: number;
  abortSignal?: AbortSignal;
  /** Extra HTTP headers sent with each provider request. */
  headers?: Record<string, string>;
  /** Provider-specific input, keyed by provider id: `{ google: { ... } }`. */
  providerOptions?: ProviderOptions;
};

/** Fields every calsdk result carries. */
export type ResultMetadata = {
  /** Parts of the request the provider could not honor, or fallbacks calsdk used. */
  warnings: Warning[];
  /** Provider-specific output, keyed by provider id. */
  providerMetadata?: ProviderMetadata;
  /** Raw response information, for debugging only. */
  response?: { headers?: Record<string, string>; body?: unknown };
};

/** A point in time: a `Date` or an ISO 8601 string. */
export type TimeInput = Date | string;
