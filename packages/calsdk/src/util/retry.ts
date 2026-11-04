import { APICallError, RateLimitError } from '@calsdk/provider';
import { parseRetryAfterMs } from '@calsdk/provider-utils';

const INITIAL_DELAY_MS = 1000;
const BACKOFF_FACTOR = 2;
// A longer Retry-After is not waited out: the error is rethrown so a single call
// never hangs for minutes, and the app can reschedule the work.
const MAX_RETRY_AFTER_MS = 60_000;

export type RetryPolicy = {
  maxRetries: number;
  abortSignal: AbortSignal | undefined;
  /**
   * `'retryable'`: retry any error marked retryable.
   * `'rateLimitOnly'`: only retry rate limits, which the provider rejected before
   * doing any work. Used for creates, where retrying a 5xx could duplicate the event.
   */
  retryOn: 'retryable' | 'rateLimitOnly';
};

export function isRetryableError(error: unknown, retryOn: RetryPolicy['retryOn']): boolean {
  if (RateLimitError.isInstance(error)) return true;
  if (retryOn === 'rateLimitOnly') return false;
  return APICallError.isInstance(error) && error.isRetryable;
}

function retryAfterMs(error: unknown): number | undefined {
  if (RateLimitError.isInstance(error)) return error.retryAfterMs;
  if (APICallError.isInstance(error)) return parseRetryAfterMs(error.responseHeaders);
  return undefined;
}

function sleep(ms: number, abortSignal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) return reject(abortSignal.reason);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortSignal?.reason);
    };
    const timeout = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runs `fn`, retrying per `policy`. The last error is rethrown unchanged. */
export async function withRetries<T>(
  policy: RetryPolicy,
  fn: (attempt: number) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    policy.abortSignal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= policy.maxRetries || !isRetryableError(error, policy.retryOn)) throw error;
      const retryAfter = retryAfterMs(error);
      if (retryAfter !== undefined && retryAfter > MAX_RETRY_AFTER_MS) throw error;
      await sleep(retryAfter ?? INITIAL_DELAY_MS * BACKOFF_FACTOR ** attempt, policy.abortSignal);
    }
  }
}
