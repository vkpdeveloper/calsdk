import { APICallError, InvalidArgumentError } from '@calsdk/provider';
import { combineHeaders, type FetchFunction } from '@calsdk/provider-utils';

const MAX_REDIRECTS = 5;

export type Feed = { text: string; etag?: string; lastModified?: string };

/**
 * The `http(s)` URL of a feed address. `webcal://` and `webcals://` are how calendar apps
 * link feeds, and both are served over HTTPS.
 */
export function feedURL(address: string): URL {
  let url: URL;
  try {
    url = new URL(address.replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new InvalidArgumentError({
      argument: 'url',
      message: 'The feed URL is not a valid URL.',
    });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidArgumentError({
      argument: 'url',
      message: `Feeds are read over HTTP(S), not ${url.protocol}`,
    });
  }
  return url;
}

/**
 * Downloads a feed, following redirects. Private feed URLs carry their secret in the path
 * or query, so errors only name the origin. `headers` (which may hold credentials) are only
 * sent to the feed's own origin: redirects elsewhere get none.
 *
 * Returns `'not-modified'` when the server confirms the copy described by `ifNoneMatch` or
 * `ifModifiedSince` is still current. Without them, a 304 is an error like other statuses.
 */
export async function fetchFeed({
  url,
  headers,
  fetch = globalThis.fetch,
  abortSignal,
  ifNoneMatch,
  ifModifiedSince,
}: {
  url: URL;
  headers?: Record<string, string | undefined>;
  fetch?: FetchFunction;
  abortSignal?: AbortSignal;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}): Promise<Feed | 'not-modified'> {
  const origin = url.origin;
  let current = url;
  for (let redirects = 0; ; redirects++) {
    abortSignal?.throwIfAborted();
    const response = await send(fetch, current, origin, {
      method: 'GET',
      headers: combineHeaders(
        { accept: 'text/calendar, */*;q=0.1' },
        current.origin === origin ? headers : undefined,
        { 'if-none-match': ifNoneMatch, 'if-modified-since': ifModifiedSince },
      ),
      redirect: 'manual',
      signal: abortSignal,
    });

    if (response.status === 304 && (ifNoneMatch || ifModifiedSince)) {
      await response.body?.cancel().catch(() => {});
      return 'not-modified';
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      const next = new URL(location, current);
      if (
        redirects === MAX_REDIRECTS ||
        (next.protocol !== 'https:' && next.protocol !== 'http:')
      ) {
        throw new APICallError({
          message: `The feed at ${origin} redirected too often or to an unsupported address.`,
          url: origin,
          statusCode: response.status,
          isRetryable: false,
        });
      }
      current = next;
      continue;
    }
    // Browsers hide manual redirects behind an opaque response.
    if (response.type === 'opaqueredirect') {
      throw new APICallError({
        message: `The feed at ${origin} redirected, and this runtime does not expose redirects.`,
        url: origin,
        isRetryable: false,
      });
    }

    const responseHeaders = Object.fromEntries(response.headers);
    if (!response.ok) {
      // Error pages can echo the requested path, so the body is not kept.
      await response.body?.cancel().catch(() => {});
      throw new APICallError({
        message: `The feed at ${origin} answered with status ${response.status}.`,
        url: origin,
        statusCode: response.status,
        responseHeaders,
      });
    }
    const text = await readText(response, origin, abortSignal);
    return {
      text,
      etag: responseHeaders.etag,
      lastModified: responseHeaders['last-modified'],
    };
  }
}

async function send(
  fetch: FetchFunction,
  url: URL,
  origin: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw networkError(init.signal ?? undefined, origin);
  }
}

async function readText(response: Response, origin: string, signal: AbortSignal | undefined) {
  try {
    return await response.text();
  } catch {
    throw networkError(signal, origin);
  }
}

function networkError(signal: AbortSignal | undefined, origin: string): unknown {
  if (signal?.aborted) return signal.reason;
  // Network errors can echo the full URL, so they are not attached as the cause.
  return new APICallError({
    message: `The request to the feed at ${origin} failed without a response.`,
    url: origin,
    isRetryable: true,
  });
}
