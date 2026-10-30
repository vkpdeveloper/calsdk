import { APICallError, type CallOptionsV1 } from '@calsdk/provider';
import { combineHeaders, type FetchFunction } from '@calsdk/provider-utils';

const MAX_REDIRECTS = 5;

export type Call = Pick<CallOptionsV1, 'headers' | 'abortSignal'>;

export type DavRequest = {
  method: 'GET' | 'PUT' | 'DELETE' | 'PROPFIND' | 'REPORT';
  url: URL;
  call: Call;
  depth?: '0' | '1';
  /** XML for `PROPFIND` and `REPORT`, iCalendar for `PUT`. */
  body?: string;
  headers?: Record<string, string | undefined>;
  /** Statuses returned to the caller instead of thrown, such as 404 for a lookup. */
  allow?: number[];
};

export type DavResponse = { status: number; url: URL; etag?: string; text: string };

export type DavClient = {
  request(request: DavRequest): Promise<DavResponse>;
  /** Lets credentials go to `origin`, such as the host discovery found the calendars on. */
  trust(origin: string): void;
};

/**
 * Sends WebDAV requests with Basic authentication. Credentials only go to trusted origins:
 * the server's own and those discovery adds. Redirects are followed by hand, so a redirect to
 * another origin fails instead of leaking the password.
 */
export function createDavClient({
  serverUrl,
  username,
  password,
  headers,
  fetch = globalThis.fetch,
}: {
  serverUrl: URL;
  username: string;
  password: string;
  headers?: Record<string, string | undefined>;
  fetch?: FetchFunction;
}): DavClient {
  const trusted = new Set([serverUrl.origin]);
  const authorization = `Basic ${base64(`${username}:${password}`)}`;

  async function request({
    method,
    url,
    call,
    depth,
    body,
    headers: requestHeaders,
    allow = [],
  }: DavRequest): Promise<DavResponse> {
    let current = url;
    for (let redirects = 0; ; redirects++) {
      if (!trusted.has(current.origin)) {
        throw new APICallError({
          message: `Refusing to send the CalDAV credentials to ${current.origin}.`,
          url: current.href,
          isRetryable: false,
        });
      }
      call.abortSignal?.throwIfAborted();
      const response = await send(fetch, current, {
        method,
        headers: combineHeaders(
          body === undefined
            ? undefined
            : {
                'content-type':
                  method === 'PUT'
                    ? 'text/calendar; charset=utf-8'
                    : 'application/xml; charset=utf-8',
              },
          { depth },
          headers,
          requestHeaders,
          call.headers,
          { authorization },
        ),
        body,
        redirect: 'manual',
        signal: call.abortSignal,
      });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => {});
        if (redirects === MAX_REDIRECTS) {
          throw new APICallError({
            message: `${current.href} redirected too often.`,
            url: current.href,
            statusCode: response.status,
            isRetryable: false,
          });
        }
        current = new URL(location, current);
        continue;
      }
      // Browsers hide manual redirects behind an opaque response.
      if (response.type === 'opaqueredirect') {
        throw new APICallError({
          message: `${current.href} redirected, and this runtime does not expose redirects.`,
          url: current.href,
          isRetryable: false,
        });
      }

      const text = await readText(response, call.abortSignal);
      if (!response.ok && !allow.includes(response.status)) {
        throw new APICallError({
          message: `${method} ${current.href} failed with status ${response.status}.`,
          url: current.href,
          statusCode: response.status,
          responseHeaders: Object.fromEntries(response.headers),
          responseBody: text,
        });
      }
      return {
        status: response.status,
        url: current,
        etag: response.headers.get('etag') ?? undefined,
        text,
      };
    }
  }

  return { request, trust: (origin) => trusted.add(origin) };
}

async function send(fetch: FetchFunction, url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw networkError(init.signal ?? undefined, url, error);
  }
}

async function readText(response: Response, signal: AbortSignal | undefined): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw networkError(signal, new URL(response.url || 'about:blank'), error);
  }
}

function networkError(signal: AbortSignal | undefined, url: URL, cause: unknown): unknown {
  if (signal?.aborted) return signal.reason;
  return new APICallError({
    message: `The request to ${url.href} failed without a response.`,
    url: url.href,
    cause,
    isRetryable: true,
  });
}

// Passwords can hold any character, so they are encoded as UTF-8 before base64.
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}
