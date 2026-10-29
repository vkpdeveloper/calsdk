import { z } from 'zod';

/** `providerOptions.google` for `createEvent` and `updateEvent`. */
export const googleEventOptionsSchema = z.object({
  guestsCanModify: z.boolean().optional(),
  guestsCanInviteOthers: z.boolean().optional(),
  guestsCanSeeOtherGuests: z.boolean().optional(),
  /** Custom key/value data stored on the event. `private` is only visible on this calendar. */
  extendedProperties: z
    .object({
      private: z.record(z.string(), z.string()).optional(),
      shared: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});
export type GoogleEventOptions = z.infer<typeof googleEventOptionsSchema>;

/** `providerOptions.google` for `listEvents`. */
export const googleListEventsOptionsSchema = z.object({
  /** Only return these event types. Google returns every type by default. */
  eventTypes: z
    .array(
      z.enum(['birthday', 'default', 'focusTime', 'fromGmail', 'outOfOffice', 'workingLocation']),
    )
    .optional(),
});
export type GoogleListEventsOptions = z.infer<typeof googleListEventsOptionsSchema>;

/** `providerMetadata.google` on events. */
export type GoogleEventMetadata = {
  iCalUID?: string;
  /** `'default'`, `'outOfOffice'`, `'focusTime'`, `'workingLocation'`, `'birthday'` or `'fromGmail'`. */
  eventType?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
};
