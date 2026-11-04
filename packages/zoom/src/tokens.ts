import { InvalidArgumentError } from '@cal-sdk/provider';
import { z } from 'zod';

// Tokens only hold meeting ids, instants and hashes, which are ASCII.
function codec<Schema extends z.ZodType>(schema: Schema, argument: 'pageToken' | 'cursor') {
  return {
    encode: (value: z.infer<Schema>) => btoa(JSON.stringify(value)),
    decode(token: string): z.infer<Schema> {
      try {
        const parsed = schema.safeParse(JSON.parse(atob(token)));
        if (parsed.success) return parsed.data;
      } catch {
        // Not base64 JSON: rejected below.
      }
      throw new InvalidArgumentError({
        argument,
        message: `The ${argument === 'cursor' ? 'cursor' : 'page token'} was not issued by the Zoom provider.`,
      });
    },
  };
}

/** The last event of a listing page: the next page starts after it in (start, id) order. */
export const pageToken = codec(z.object({ start: z.number(), id: z.string() }), 'pageToken');

/**
 * What the last sync saw. Zoom cannot list meetings by when they changed, so each sync
 * reads every meeting and compares it with its hash from the last one. `end` is when the
 * event ends, to tell expired meetings, which Zoom stops listing, from deleted ones.
 */
export const syncCursor = codec(
  z.object({ events: z.array(z.tuple([z.string(), z.string(), z.number()])) }),
  'cursor',
);

/** FNV-1a: a short fingerprint of an event, to tell whether it changed between syncs. */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
