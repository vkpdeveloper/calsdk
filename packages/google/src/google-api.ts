import { z } from 'zod';

// Response shapes of the Google Calendar API v3, reduced to the fields calsdk reads.
// Fields stay optional where Google omits them, for example on cancelled events.

const googleTimeSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});
export type GoogleTime = z.infer<typeof googleTimeSchema>;

const personSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  self: z.boolean().optional(),
});

export const googleEventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  etag: z.string().optional(),
  htmlLink: z.string().optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  colorId: z.string().optional(),
  organizer: personSchema.optional(),
  start: googleTimeSchema.optional(),
  end: googleTimeSchema.optional(),
  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().optional(),
  originalStartTime: googleTimeSchema.optional(),
  transparency: z.string().optional(),
  visibility: z.string().optional(),
  iCalUID: z.string().optional(),
  eventType: z.string().optional(),
  attendees: z
    .array(
      personSchema.extend({
        organizer: z.boolean().optional(),
        optional: z.boolean().optional(),
        responseStatus: z.string().optional(),
      }),
    )
    .optional(),
  hangoutLink: z.string().optional(),
  // Kept whole: splitting a series copies it so the meeting link carries over.
  conferenceData: z
    .looseObject({
      conferenceId: z.string().optional(),
      conferenceSolution: z
        .looseObject({ key: z.looseObject({ type: z.string().optional() }).optional() })
        .optional(),
      entryPoints: z
        .array(z.looseObject({ entryPointType: z.string().optional(), uri: z.string().optional() }))
        .optional(),
    })
    .optional(),
  reminders: z
    .object({
      useDefault: z.boolean().optional(),
      overrides: z.array(z.object({ method: z.string(), minutes: z.number() })).optional(),
    })
    .optional(),
  extendedProperties: z
    .object({
      private: z.record(z.string(), z.string()).optional(),
      shared: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  guestsCanModify: z.boolean().optional(),
  guestsCanInviteOthers: z.boolean().optional(),
  guestsCanSeeOtherGuests: z.boolean().optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;

export const googleEventListSchema = z.object({
  items: z.array(googleEventSchema).optional(),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
  /** The calendar's zone, used for event times that carry none. */
  timeZone: z.string().optional(),
});

export const googleCalendarListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string().optional(),
        summaryOverride: z.string().optional(),
        description: z.string().optional(),
        timeZone: z.string().optional(),
        backgroundColor: z.string().optional(),
        primary: z.boolean().optional(),
        accessRole: z.string().optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});

export const googleCalendarSchema = z.object({ timeZone: z.string().optional() });

export const googleFreeBusySchema = z.object({
  calendars: z
    .record(
      z.string(),
      z.object({
        busy: z.array(z.object({ start: z.string(), end: z.string() })).optional(),
        errors: z.array(z.object({ domain: z.string().optional(), reason: z.string() })).optional(),
      }),
    )
    .optional(),
});

/** Google error bodies: `{ error: { code, message, errors: [{ reason }] } }`. */
export const googleErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});
