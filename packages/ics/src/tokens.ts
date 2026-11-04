import { InvalidArgumentError } from '@calsdk/provider';
import { z } from 'zod';

/** Where the next page of a listing starts: after this start instant and event id. */
const listTokenSchema = z.object({ start: z.number(), id: z.string() });
export type ListToken = z.infer<typeof listTokenSchema>;

/**
 * What the last sync saw. Feeds have no change history, so each sync downloads the feed
 * and compares every event with its hash from the last one.
 */
const syncCursorSchema = z.object({
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  /** `[event id, hash]` pairs. Pairs rather than an object, so ids such as `__proto__` stay data. */
  events: z.array(z.tuple([z.string(), z.string()])),
});
export type SyncCursor = z.infer<typeof syncCursorSchema>;

// UIDs can hold any character, so the JSON is encoded as UTF-8 before base64.
export function encodeToken(token: ListToken | SyncCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(token));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function decode<Output>(token: string, schema: z.ZodType<Output>, argument: string): Output {
  try {
    const bytes = Uint8Array.from(atob(token), (char) => char.charCodeAt(0));
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (parsed.success) return parsed.data;
  } catch {
    // Not base64 JSON: rejected below.
  }
  throw new InvalidArgumentError({
    argument,
    message: `The ${argument} was not issued by the ICS provider.`,
  });
}

export const decodeListToken = (token: string) => decode(token, listTokenSchema, 'pageToken');
export const decodeSyncCursor = (token: string) => decode(token, syncCursorSchema, 'cursor');

/** FNV-1a: a short fingerprint of an event, to tell whether it changed between syncs. */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
