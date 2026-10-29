import { APICallError, InvalidResponseDataError } from '@calsdk/provider';
import { combineHeaders } from './headers';
import { formatSchemaIssues, type StandardSchemaV1, validateSchema } from './validate-schema';

export type FetchFunction = typeof globalThis.fetch;

/** A token, or a function returning a fresh one. Functions are called once per request. */
export type AccessToken = string | (() => PromiseLike<string> | string);

export type QueryValue = string | number | boolean | undefined;

export type JsonRequest<Output> = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * Path below `baseURL`. Build it with `urlPath` so ids are encoded.
   * Absolute URLs (for example pagination links) must share the origin of `baseURL`.
   */
  path: string;
  query?: Record<string, QueryValue | QueryValue[]>;
  /** Serialized as JSON. */
  body?: unknown;
  headers?: Record<string, string | undefined>;
  /** Validates the parsed JSON body. Omit for responses without a body. */
  schema?: StandardSchemaV1<unknown, Output>;
  abortSignal?: AbortSignal;
};

export type JsonResponse<Output> = {
  value: Output;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  /** Parsed JSON body before validation, `undefined` for empty bodies. */
  rawValue: unknown;
};

export type JsonFetcher = <Output = undefined>(
  request: JsonRequest<Output>,
) => Promise<JsonResponse<Output>>;

/**
 * Builds a URL path from a template, percent-encoding every interpolated value.
 * Calendar and event ids can contain `@`, `/` and `#`, so never interpolate them raw.
 *
 * @example
 * urlPath`/calendars/${calendarId}/events/${eventId}`
 */
export function urlPath(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce(
    (path, part, index) =>
      path + part + (index < values.length ? encodeURIComponent(values[index] as string) : ''),
    '',
  );
}

/**
 * Creates a small JSON-over-fetch client for a provider API.
 *
 * - Sends `Authorization: Bearer <token>`, resolving the token per request.
 * - Throws `APICallError` for non-2xx responses and network failures. It never
 *   includes request headers, so the token cannot leak through errors.
 * - Validates response bodies with the request's schema and throws
 *   `InvalidResponseDataError` on mismatch.
 * - Abort errors are rethrown unchanged.
 */
export function createJsonFetcher({
  baseURL,
  headers,
  accessToken,
  fetch = globalThis.fetch,
}: {
  baseURL: string;
  headers?: Record<string, string | undefined>;
  accessToken: AccessToken;
  fetch?: FetchFunction;
}): JsonFetcher {
  const base = baseURL.replace(/\/+$/, '');

  return async <Output>(request: JsonRequest<Output>) => {
    const url = buildURL(base, request.path, request.query);
    const token = typeof accessToken === 'function' ? await accessToken() : accessToken;

    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers: combineHeaders(
          { accept: 'application/json' },
          request.body !== undefined ? { 'content-type': 'application/json' } : undefined,
          headers,
          request.headers,
          { authorization: `Bearer ${token}` },
        ),
        body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
        signal: request.abortSignal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new APICallError({
        message: `Request to ${url} failed before a response was received: ${errorMessage(error)}`,
        url,
        cause: error,
        isRetryable: true,
      });
    }

    const responseHeaders = Object.fromEntries(response.headers);
    const text = await response.text();

    if (!response.ok) {
      throw new APICallError({
        message: `Request to ${url} failed with status ${response.status}${describeErrorBody(text)}`,
        url,
        statusCode: response.status,
        responseHeaders,
        responseBody: text,
      });
    }

    let rawValue: unknown;
    if (text.length > 0) {
      try {
        rawValue = JSON.parse(text);
      } catch (error) {
        throw new InvalidResponseDataError({
          data: text,
          message: `Response from ${url} is not valid JSON.`,
          cause: error,
        });
      }
    }

    if (!request.schema) {
      return { value: undefined as Output, headers: responseHeaders, rawValue };
    }

    const result = await validateSchema(request.schema, rawValue);
    if (!result.success) {
      throw new InvalidResponseDataError({
        data: rawValue,
        message: `Response from ${url} has an unexpected shape (${formatSchemaIssues(result.issues)}). This is likely a calsdk bug: please report it.`,
        cause: result.issues,
      });
    }
    return { value: result.value, headers: responseHeaders, rawValue };
  };
}

function buildURL(
  base: string,
  path: string,
  query: Record<string, QueryValue | QueryValue[]> | undefined,
): string {
  const url = new URL(/^https?:\/\//.test(path) ? path : `${base}${path}`);
  // The bearer token goes to whatever URL we build, so links taken from
  // response bodies must never point at another host.
  if (url.origin !== new URL(base).origin) {
    throw new InvalidResponseDataError({
      data: path,
      message: `Refusing to send a request to ${url.origin}: it does not match the provider origin ${new URL(base).origin}.`,
    });
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) url.searchParams.append(key, String(item));
    }
  }
  return url.toString();
}

/** Google and Microsoft both report errors as `{ error: { message } }`. */
function describeErrorBody(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body;
      if (typeof error === 'object' && error !== null && 'message' in error) {
        if (typeof error.message === 'string') return `: ${error.message}`;
      }
    }
  } catch {
    // Not JSON: the raw body stays available on `responseBody`.
  }
  return '.';
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
