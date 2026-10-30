import { InvalidArgumentError } from '@calsdk/provider';
import { z } from 'zod';

/** Where the next page of a listing starts: after this start instant and event id. */
const listTokenSchema = z.object({ start: z.number(), id: z.string() });
export type ListToken = z.infer<typeof listTokenSchema>;

const syncCursorSchema = z.object({
  /** The server's RFC 6578 sync token. */
  syncToken: z.string(),
  /**
   * Instance keys of the exceptions each event had, for events that had any. The server only
   * reports that a resource changed or went away, so this tells which exceptions went with it.
   */
  exceptions: z.array(z.tuple([z.string(), z.array(z.string())])),
});
export type SyncCursor = z.infer<typeof syncCursorSchema>;

// Event ids can hold any character, so the JSON is encoded as UTF-8 before base64.
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
    message: `The ${argument} was not issued by the CalDAV provider.`,
  });
}

export const decodeListToken = (token: string) => decode(token, listTokenSchema, 'pageToken');
export const decodeSyncCursor = (token: string) => decode(token, syncCursorSchema, 'cursor');
