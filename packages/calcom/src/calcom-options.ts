import { z } from 'zod';

const bookingRules = {
  /** Book even when the slot overlaps other bookings or busy time. Defaults to `true`. */
  allowConflicts: z.boolean().optional(),
  /**
   * Book outside the event type's availability, notice and booking window. Defaults to
   * `true`: like other calendars, calsdk writes the times it is given.
   */
  allowBookingOutOfBounds: z.boolean().optional(),
};

/** `providerOptions.calcom` for `createEvent`. */
export const calcomCreateOptionsSchema = z.object({
  /** The event type to book. Required on the `'primary'` calendar, which holds every booking. */
  eventTypeId: z.number().int().positive().optional(),
  /** Your own key/value data, stored on the booking and returned in its metadata. */
  metadata: z.record(z.string(), z.string()).optional(),
  ...bookingRules,
});
export type CalcomCreateOptions = z.infer<typeof calcomCreateOptionsSchema>;

/** `providerOptions.calcom` for `updateEvent`. */
export const calcomUpdateOptionsSchema = z.object({
  /** Shown to attendees in the reschedule email. */
  reschedulingReason: z.string().optional(),
  ...bookingRules,
});
export type CalcomUpdateOptions = z.infer<typeof calcomUpdateOptionsSchema>;

/** `providerOptions.calcom` for `deleteEvent`. */
export const calcomDeleteOptionsSchema = z.object({
  /** Shown to attendees in the cancellation email. Defaults to `'Cancelled'`. */
  cancellationReason: z.string().min(1).optional(),
});
export type CalcomDeleteOptions = z.infer<typeof calcomDeleteOptionsSchema>;

/** The option and metadata types of the Cal.com provider, for type checking in `calsdk`. */
export type CalcomProviderTypes = {
  options: {
    createEvent: CalcomCreateOptions;
    updateEvent: CalcomUpdateOptions;
    deleteEvent: CalcomDeleteOptions;
  };
  eventMetadata: CalcomEventMetadata;
};

/** `providerMetadata.calcom` on events. */
export type CalcomEventMetadata = {
  /** Cal.com's numeric booking id. The event id is the booking's `uid`. */
  bookingId: number;
  eventTypeId?: number;
  /** `'accepted'`, `'pending'` or `'awaiting_host'`. */
  status: string;
  /** The booking this one replaced when it was rescheduled. */
  rescheduledFromUid?: string;
  metadata?: Record<string, string>;
};
