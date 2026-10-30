/**
 * Whether a provider supports a feature.
 *
 * - `true` / `false`: always / never supported.
 * - `'unknown'`: the provider cannot tell ahead of time. This is not the same as unsupported.
 * - `{ condition }`: supported only under the described condition.
 */
export type CapabilityV1 = boolean | 'unknown' | { condition: string };

/**
 * What a provider can do. Core uses it to pick fallbacks, the conformance suite
 * runs only the tests for declared capabilities, and the docs render it as a matrix.
 */
export type CalendarCapabilitiesV1 = {
  events: {
    /**
     * Events keep the title and description they are written with, on create and update.
     * Booking tools such as Cal.com name events from a template instead.
     */
    details: CapabilityV1;
    /** Create all-day events. */
    allDay: CapabilityV1;
    /** Create and read recurring series. */
    recurrence: CapabilityV1;
    /** `scope: 'thisAndFollowing'` on update and delete. */
    recurrenceScopeThisAndFollowing: CapabilityV1;
    /** `expandRecurring: true` returns occurrences computed by the provider. */
    serverSideExpansion: CapabilityV1;
    attendees: CapabilityV1;
    /** `createConference: true` creates a meeting link. */
    conference: CapabilityV1;
    reminders: CapabilityV1;
    color: CapabilityV1;
    /** Events carry `etag` and writes honor `ifMatch`. */
    etag: CapabilityV1;
    /** `query` on list events. */
    search: CapabilityV1;
  };
  /** Native `doFreeBusy`. Without it, core computes free/busy from events. */
  freeBusy: CapabilityV1;
  /** `doSyncEvents`. */
  sync: CapabilityV1;
  /** `doSubscribe` and friends. */
  webhooks: CapabilityV1;
};
