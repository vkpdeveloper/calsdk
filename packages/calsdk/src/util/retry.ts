import { APICallError, RateLimitError } from '@calsdk/provider';
import { parseRetryAfterMs } from '@calsdk/provider-utils';

const INITIAL_DELAY_MS = 1000;
const BACKOFF_FACTOR = 2;
// Longer Retry-After values are ignored in favor of normal backoff, so a single
// call never hangs for minutes.
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

function retryDelayMs(error: unknown, attempt: number): number {
  const backoff = INITIAL_DELAY_MS * BACKOFF_FACTOR ** attempt;
  const retryAfter = RateLimitError.isInstance(error)
    ? error.retryAfterMs
    : APICallError.isInstance(error)
      ? parseRetryAfterMs(error.responseHeaders)
      : undefined;
  if (retryAfter !== undefined && retryAfter <= MAX_RETRY_AFTER_MS) return retryAfter;
  return backoff;
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
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= policy.maxRetries || !isRetryableError(error, policy.retryOn)) throw error;
      await sleep(retryDelayMs(error, attempt), policy.abortSignal);
    }
  }
}
