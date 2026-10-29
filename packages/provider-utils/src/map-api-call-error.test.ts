import {
  APICallError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { mapAPICallError, parseRetryAfterMs } from './map-api-call-error';

const apiError = (statusCode: number, responseHeaders?: Record<string, string>) =>
  new APICallError({ message: 'x', url: 'https://x', statusCode, responseHeaders });

describe('mapAPICallError', () => {
  const context = {
    provider: 'google',
    resource: { type: 'event', id: 'e1' },
    eventId: 'e1',
  } as const;

  it.each([
    [401, AuthenticationError.isInstance],
    [403, PermissionDeniedError.isInstance],
    [404, NotFoundError.isInstance],
    [410, NotFoundError.isInstance],
    [412, ConflictError.isInstance],
    [429, RateLimitError.isInstance],
  ])('maps %s', (status, isInstance) => {
    const mapped = mapAPICallError(apiError(status), context);
    expect(isInstance(mapped)).toBe(true);
    expect((mapped as Error).cause).toBeInstanceOf(APICallError);
  });

  it('keeps 404 and 412 unchanged without context', () => {
    const notFound = apiError(404);
    expect(mapAPICallError(notFound, { provider: 'google' })).toBe(notFound);
    const conflict = apiError(412);
    expect(mapAPICallError(conflict, { provider: 'google' })).toBe(conflict);
  });

  it('passes the Retry-After delay to RateLimitError', () => {
    const mapped = mapAPICallError(apiError(429, { 'retry-after': '3' }), context);
    expect((mapped as RateLimitError).retryAfterMs).toBe(3000);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads retry-after-ms, seconds and HTTP dates', () => {
    expect(parseRetryAfterMs({ 'retry-after-ms': '150' })).toBe(150);
    expect(parseRetryAfterMs({ 'retry-after': '1.5' })).toBe(1500);
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs({ 'retry-after': 'Thu, 01 Jan 2026 00:00:05 GMT' }, now)).toBe(5000);
  });

  it('ignores garbage', () => {
    expect(parseRetryAfterMs({ 'retry-after': 'soon' })).toBeUndefined();
    expect(parseRetryAfterMs({ 'retry-after-ms': '-1' })).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });
});
