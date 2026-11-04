import { z } from 'zod';

/** `providerOptions.calendly` for `createEvent`. */
export const calendlyCreateOptionsSchema = z.object({
  /**
   * The event type to book: its URI (`https://api.calendly.com/event_types/<uuid>`) or uuid.
   * Calendly books every meeting on an event type.
   */
  eventType: z.string().min(1),
  /**
   * Where to meet, for event types that offer several places or ask the invitee. Passed to
   * Calendly as is: `{ kind: 'zoom_conference' }` or `{ kind: 'physical', location: '...' }`.
   */
  location: z.object({ kind: z.string(), location: z.string().optional() }).optional(),
});
export type CalendlyCreateOptions = z.infer<typeof calendlyCreateOptionsSchema>;

/** `providerOptions.calendly` for `deleteEvent`. */
export const calendlyDeleteOptionsSchema = z.object({
  /** Shown to invitees in the cancellation email. */
  reason: z.string().optional(),
});
export type CalendlyDeleteOptions = z.infer<typeof calendlyDeleteOptionsSchema>;

/** The option and metadata types of the Calendly provider, for type checking in `calsdk`. */
export type CalendlyProviderTypes = {
  options: {
    createEvent: CalendlyCreateOptions;
    deleteEvent: CalendlyDeleteOptions;
  };
  eventMetadata: CalendlyEventMetadata;
};

/** `providerMetadata.calendly` on events. */
export type CalendlyEventMetadata = {
  /** The scheduled event's URI. The event id is its uuid. */
  uri: string;
  /** The URI of the event type it was booked on. */
  eventType?: string;
};
