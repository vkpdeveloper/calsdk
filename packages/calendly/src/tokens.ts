import { InvalidArgumentError } from '@calsdk/provider';
import { z } from 'zod';

/**
 * What the last sync saw. Calendly cannot list meetings by when they changed, so each sync
 * reads every active meeting and compares it with its hash from the last one.
 */
const syncCursorSchema = z.object({
  /** `[event id, hash]` pairs. */
  events: z.array(z.tuple([z.string(), z.string()])),
});
export type SyncCursor = z.infer<typeof syncCursorSchema>;

// Cursors only hold uuids and hashes, which are ASCII.
export function encodeSyncCursor(cursor: SyncCursor): string {
  return btoa(JSON.stringify(cursor));
}

export function decodeSyncCursor(cursor: string): SyncCursor {
  try {
    const parsed = syncCursorSchema.safeParse(JSON.parse(atob(cursor)));
    if (parsed.success) return parsed.data;
  } catch {
    // Not base64 JSON: rejected below.
  }
  throw new InvalidArgumentError({
    argument: 'cursor',
    message: 'The cursor was not issued by the Calendly provider.',
  });
}

/** FNV-1a: a short fingerprint of an event, to tell whether it changed between syncs. */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
