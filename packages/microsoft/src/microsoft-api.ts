import { z } from 'zod';

// Response shapes of Microsoft Graph v1.0 calendar resources, reduced to the fields calsdk
// reads. Requests ask for UTC times (`Prefer: outlook.timezone="UTC"`) and text bodies.

/** `dateTime` has no offset (`'2026-11-03T15:00:00.0000000'`); it is in `timeZone`. */
const graphTimeSchema = z.object({ dateTime: z.string(), timeZone: z.string().optional() });
export type GraphTime = z.infer<typeof graphTimeSchema>;

const emailAddressSchema = z.object({
  address: z.string().optional(),
  name: z.string().optional(),
});

const weekdaySchema = z.enum([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);
export type GraphWeekday = z.infer<typeof weekdaySchema>;

export const graphRecurrenceSchema = z.object({
  pattern: z.object({
    type: z.enum([
      'daily',
      'weekly',
      'absoluteMonthly',
      'relativeMonthly',
      'absoluteYearly',
      'relativeYearly',
    ]),
    interval: z.number(),
    month: z.number().optional(),
    dayOfMonth: z.number().optional(),
    daysOfWeek: z.array(weekdaySchema).optional(),
    firstDayOfWeek: weekdaySchema.optional(),
    index: z.enum(['first', 'second', 'third', 'fourth', 'last']).optional(),
  }),
  range: z.object({
    type: z.enum(['endDate', 'noEnd', 'numbered']),
    startDate: z.string(),
    endDate: z.string().nullish(),
    recurrenceTimeZone: z.string().nullish(),
    numberOfOccurrences: z.number().nullish(),
  }),
});
export type GraphRecurrence = z.infer<typeof graphRecurrenceSchema>;

export const graphEventSchema = z.object({
  id: z.string(),
  '@odata.etag': z.string().optional(),
  type: z.enum(['singleInstance', 'occurrence', 'exception', 'seriesMaster']).optional(),
  seriesMasterId: z.string().nullish(),
  /** Start of an instance according to the series pattern, an ISO instant. */
  originalStart: z.string().nullish(),
  /** Windows or IANA name of the zone the event was scheduled in. */
  originalStartTimeZone: z.string().nullish(),
  originalEndTimeZone: z.string().nullish(),
  subject: z.string().nullish(),
  body: z.object({ content: z.string().nullish() }).nullish(),
  location: z.object({ displayName: z.string().nullish() }).nullish(),
  start: graphTimeSchema.optional(),
  end: graphTimeSchema.optional(),
  isAllDay: z.boolean().optional(),
  isCancelled: z.boolean().optional(),
  recurrence: graphRecurrenceSchema.nullish(),
  showAs: z.string().optional(),
  sensitivity: z.string().optional(),
  importance: z.string().optional(),
  categories: z.array(z.string()).optional(),
  organizer: z.object({ emailAddress: emailAddressSchema.optional() }).nullish(),
  attendees: z
    .array(
      z.object({
        type: z.string().optional(),
        emailAddress: emailAddressSchema.optional(),
        status: z.object({ response: z.string().optional() }).nullish(),
      }),
    )
    .optional(),
  isOrganizer: z.boolean().optional(),
  isOnlineMeeting: z.boolean().optional(),
  onlineMeetingProvider: z.string().optional(),
  onlineMeeting: z.object({ joinUrl: z.string().nullish() }).nullish(),
  isReminderOn: z.boolean().optional(),
  reminderMinutesBeforeStart: z.number().optional(),
  webLink: z.string().nullish(),
  iCalUId: z.string().nullish(),
  createdDateTime: z.string().optional(),
  lastModifiedDateTime: z.string().optional(),
  /** Set on delta entries for deleted events. */
  '@removed': z.object({ reason: z.string().optional() }).optional(),
});
export type GraphEvent = z.infer<typeof graphEventSchema>;

export const graphEventListSchema = z.object({
  value: z.array(graphEventSchema),
  '@odata.nextLink': z.string().optional(),
  '@odata.deltaLink': z.string().optional(),
});

export const graphCalendarSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  hexColor: z.string().nullish(),
  isDefaultCalendar: z.boolean().optional(),
  canEdit: z.boolean().optional(),
  canShare: z.boolean().optional(),
});

export const graphCalendarListSchema = z.object({
  value: z.array(graphCalendarSchema),
  '@odata.nextLink': z.string().optional(),
});

export const graphErrorSchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }),
});
