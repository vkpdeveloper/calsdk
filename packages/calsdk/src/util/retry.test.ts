import { APICallError, NotFoundError, RateLimitError } from '@calsdk/provider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRetries } from './retry';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const serverError = () => new APICallError({ message: 'x', url: 'https://x', statusCode: 503 });
const policy = { maxRetries: 2, abortSignal: undefined, retryOn: 'retryable' } as const;

describe('withRetries', () => {
  it('retries retryable errors with exponential backoff', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(serverError())
      .mockRejectedValueOnce(serverError())
      .mockResolvedValue('ok');

    const result = withRetries(policy, fn);
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + 2000);
    await expect(result).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honors Retry-After from rate limits', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new RateLimitError({ provider: 'google', retryAfterMs: 5000 }))
      .mockResolvedValue('ok');

    const result = withRetries(policy, fn);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('ok');
  });

  it('rethrows non-retryable errors and the last error after maxRetries', async () => {
    const notFound = new NotFoundError({ provider: 'google', resource: 'event', id: 'e' });
    await expect(withRetries(policy, () => Promise.reject(notFound))).rejects.toBe(notFound);

    const last = serverError();
    const fn = vi
      .fn<() => Promise<never>>()
      .mockRejectedValueOnce(serverError())
      .mockRejectedValue(last);
    const result = withRetries({ ...policy, maxRetries: 1 }, fn);
    result.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).rejects.toBe(last);
  });

  it('only retries rate limits for rateLimitOnly', async () => {
    const error = serverError();
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(error);
    await expect(withRetries({ ...policy, retryOn: 'rateLimitOnly' }, fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops waiting when aborted', async () => {
    const controller = new AbortController();
    const result = withRetries({ ...policy, abortSignal: controller.signal }, () =>
      Promise.reject(serverError()),
    );
    result.catch(() => {});
    controller.abort();
    await expect(result).rejects.toBe(controller.signal.reason);
  });
});
