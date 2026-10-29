import {
  APICallError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@calsdk/provider';

/**
 * Parses `retry-after-ms` or `Retry-After` (seconds or an HTTP date) into milliseconds.
 * Header names must be lower-case, as produced by the JSON fetcher.
 */
export function parseRetryAfterMs(
  headers: Record<string, string> | undefined,
  now: number = Date.now(),
): number | undefined {
  const retryAfterMs = Number.parseFloat(headers?.['retry-after-ms'] ?? '');
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return retryAfterMs;

  const retryAfter = headers?.['retry-after']?.trim();
  if (!retryAfter) return undefined;

  if (/^\d+(\.\d+)?$/.test(retryAfter)) return Number.parseFloat(retryAfter) * 1000;

  const date = Date.parse(retryAfter);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * Maps an `APICallError` to the matching calsdk error by status code:
 * 401 -> `AuthenticationError`, 403 -> `PermissionDeniedError`,
 * 404/410 -> `NotFoundError` (when `resource` is given), 412 -> `ConflictError`
 * (when `eventId` is given), 429 -> `RateLimitError`.
 *
 * Other errors are returned unchanged. Providers handle their own special cases
 * (for example rate limits reported as 403) before calling this.
 */
export function mapAPICallError(
  error: unknown,
  {
    provider,
    resource,
    eventId,
  }: {
    provider: string;
    /** The resource the request addressed, used for 404/410. */
    resource?: { type: 'calendar' | 'event'; id: string };
    /** The event a conditional write addressed, used for 412. */
    eventId?: string;
  },
): unknown {
  if (!APICallError.isInstance(error)) return error;

  switch (error.statusCode) {
    case 401:
      return new AuthenticationError({ provider, cause: error });
    case 403:
      return new PermissionDeniedError({ provider, cause: error });
    case 404:
    case 410:
      return resource
        ? new NotFoundError({ provider, resource: resource.type, id: resource.id, cause: error })
        : error;
    case 412:
      return eventId ? new ConflictError({ provider, eventId, cause: error }) : error;
    case 429:
      return new RateLimitError({
        provider,
        retryAfterMs: parseRetryAfterMs(error.responseHeaders),
        cause: error,
      });
    default:
      return error;
  }
}
