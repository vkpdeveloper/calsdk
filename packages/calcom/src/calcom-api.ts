import { z } from 'zod';

// Response shapes of the Cal.com API v2, reduced to the fields calsdk reads. Every
// endpoint pins its own `cal-api-version`; without it Cal.com answers with older shapes.

export const API_VERSIONS = {
  bookings: '2026-02-25',
  listBookings: '2026-05-01',
  eventTypes: '2026-06-12',
} as const;

const personSchema = z.object({
  name: z.string().nullish(),
  email: z.string().nullish(),
  timeZone: z.string().nullish(),
});

export const bookingSchema = z.object({
  id: z.number(),
  uid: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  /** `accepted`, `pending`, `awaiting_host`, `cancelled` or `rejected`. */
  status: z.string(),
  /** UTC instants. */
  start: z.string(),
  end: z.string(),
  eventTypeId: z.number().nullish(),
  location: z.string().nullish(),
  meetingUrl: z.string().nullish(),
  hosts: z.array(personSchema).nullish(),
  attendees: z.array(personSchema).nullish(),
  metadata: z.record(z.string(), z.string()).nullish(),
  rescheduledFromUid: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const bookingOutputSchema = z.object({
  // A recurring booking's uid reads back as the list of its bookings.
  data: z.union([bookingSchema, z.array(z.unknown())]),
});

export const bookingListSchema = z.object({ data: z.array(bookingSchema) });

export const eventTypeSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string().nullish(),
  lengthInMinutes: z.number(),
  lengthInMinutesOptions: z.array(z.number()).nullish(),
  recurrence: z.unknown().nullish(),
});
export type EventType = z.infer<typeof eventTypeSchema>;

export const eventTypeOutputSchema = z.object({ data: eventTypeSchema });
export const eventTypeListSchema = z.object({ data: z.array(eventTypeSchema) });

export const meOutputSchema = z.object({
  data: z.object({
    email: z.string(),
    name: z.string().nullish(),
    timeZone: z.string().nullish(),
  }),
});
