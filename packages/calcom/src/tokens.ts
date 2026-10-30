import { InvalidArgumentError } from '@calsdk/provider';
import { z } from 'zod';

// Cal.com's own list cursors page by booking uid whatever the sort, so calsdk pages by the
// sorted field itself: each token holds the last value read and the bookings already
// returned at that value, since Cal.com's `after*` filters include it.

/** Where the next page of a listing starts. */
const listTokenSchema = z.object({ start: z.string(), seen: z.array(z.string()) });
export type ListToken = z.infer<typeof listTokenSchema>;

/** A sync page token or cursor. */
const syncStateSchema = z.object({
  calendarId: z.string(),
  /** Read bookings updated at or after this instant. Missing: from the first booking. */
  after: z.string().optional(),
  /** `updatedAt` of every booking already reported at or after `after`, by uid. */
  seen: z.record(z.string(), z.string()),
  /** Part of an initial sync, which skips cancelled bookings. */
  initial: z.boolean(),
});
export type SyncState = z.infer<typeof syncStateSchema>;

// Tokens only hold uids, instants and calendar ids, which are ASCII.
export function encodeToken(token: ListToken | SyncState): string {
  return btoa(JSON.stringify(token));
}

function decode<Output>(token: string, schema: z.ZodType<Output>, argument: string): Output {
  try {
    const parsed = schema.safeParse(JSON.parse(atob(token)));
    if (parsed.success) return parsed.data;
  } catch {
    // Not base64 JSON: rejected below.
  }
  throw new InvalidArgumentError({
    argument,
    message: `The ${argument} was not issued by the Cal.com provider.`,
  });
}

export const decodeListToken = (token: string) => decode(token, listTokenSchema, 'pageToken');
export const decodeSyncState = (token: string, argument: 'cursor' | 'pageToken') =>
  decode(token, syncStateSchema, argument);
