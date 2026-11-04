import { z } from 'zod';

// Response shapes of the Zoom API v2, reduced to the fields calsdk reads.

/** Meeting types: `2` scheduled, `8` recurring with a fixed time. `1` and `3` have no times. */
export const SCHEDULED = 2;
export const RECURRING = 8;

export const zoomRecurrenceSchema = z.object({
  /** `1` daily, `2` weekly, `3` monthly. */
  type: z.number(),
  repeat_interval: z.number().nullish(),
  /** Comma-separated weekdays, `1` Sunday to `7` Saturday. */
  weekly_days: z.string().nullish(),
  monthly_day: z.number().nullish(),
  /** `1` to `4`, or `-1` for the last week. */
  monthly_week: z.number().nullish(),
  /** `1` Sunday to `7` Saturday. */
  monthly_week_day: z.number().nullish(),
  /** `0` for no end. */
  end_times: z.number().nullish(),
  /** UTC. */
  end_date_time: z.string().nullish(),
});
export type ZoomRecurrence = z.infer<typeof zoomRecurrenceSchema>;

const occurrenceSchema = z.object({
  /** The original start of the occurrence, in epoch milliseconds. */
  occurrence_id: z.string(),
  start_time: z.string(),
  duration: z.number().nullish(),
  /** `available` or `deleted`. */
  status: z.string().nullish(),
});
export type Occurrence = z.infer<typeof occurrenceSchema>;

export const meetingSchema = z.object({
  id: z.number(),
  uuid: z.string().nullish(),
  topic: z.string().nullish(),
  type: z.number(),
  /** UTC. Missing for series, whose times are on their occurrences. */
  start_time: z.string().nullish(),
  /** Minutes. Missing for series, like `start_time`. */
  duration: z.number().nullish(),
  timezone: z.string().nullish(),
  /** Cut to 250 characters in listings. */
  agenda: z.string().nullish(),
  created_at: z.string().nullish(),
  join_url: z.string().nullish(),
  host_email: z.string().nullish(),
  recurrence: zoomRecurrenceSchema.nullish(),
  /** Empty for series that start far ahead, which Zoom has not scheduled yet. */
  occurrences: z.array(occurrenceSchema).nullish(),
  settings: z
    .object({ meeting_invitees: z.array(z.object({ email: z.string() })).nullish() })
    .nullish(),
});
export type Meeting = z.infer<typeof meetingSchema>;

export const meetingListSchema = z.object({
  meetings: z.array(meetingSchema),
  next_page_token: z.string().nullish(),
});

export const userSchema = z.object({
  email: z.string().nullish(),
  timezone: z.string().nullish(),
});
