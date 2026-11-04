import { z } from 'zod';

// Response shapes of the Calendly API v2, reduced to the fields calsdk reads.

const paginationSchema = z.object({ next_page_token: z.string().nullish() });

export const userOutputSchema = z.object({
  resource: z.object({
    uri: z.string(),
    email: z.string(),
    name: z.string().nullish(),
    timezone: z.string().nullish(),
  }),
});
export type User = z.infer<typeof userOutputSchema>['resource'];

export const scheduledEventSchema = z.object({
  uri: z.string(),
  name: z.string().nullish(),
  /** `active` or `canceled`. */
  status: z.string(),
  /** UTC instants. */
  start_time: z.string(),
  end_time: z.string(),
  event_type: z.string().nullish(),
  location: z
    .object({
      /** `physical`, `zoom`, `google_conference`, `custom` and others. */
      type: z.string().nullish(),
      location: z.string().nullish(),
      join_url: z.string().nullish(),
    })
    .nullish(),
  /** The hosts. */
  event_memberships: z
    .array(z.object({ user_email: z.string().nullish(), user_name: z.string().nullish() }))
    .nullish(),
  /** People an invitee added. */
  event_guests: z.array(z.object({ email: z.string() })).nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type ScheduledEvent = z.infer<typeof scheduledEventSchema>;

export const scheduledEventOutputSchema = z.object({ resource: scheduledEventSchema });
export const scheduledEventListSchema = z.object({
  collection: z.array(scheduledEventSchema),
  pagination: paginationSchema,
});

const inviteeSchema = z.object({
  email: z.string(),
  name: z.string().nullish(),
  /** `active` or `canceled`. */
  status: z.string(),
});
export type Invitee = z.infer<typeof inviteeSchema>;

export const inviteeListSchema = z.object({
  collection: z.array(inviteeSchema),
  pagination: paginationSchema,
});
export const inviteeOutputSchema = z.object({
  resource: z.object({ event: z.string() }),
});

export const eventTypeOutputSchema = z.object({
  resource: z.object({ uri: z.string(), duration: z.number() }),
});
