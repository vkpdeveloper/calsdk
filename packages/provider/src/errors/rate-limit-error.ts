import { CalsdkError } from './calsdk-error';

const name = 'RateLimitError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/** The provider throttled the request (HTTP 429 or a quota error). Core retries it automatically. */
export class RateLimitError extends CalsdkError {
  private readonly [symbol] = true;

  readonly provider: string;
  /** How long the provider asked to wait, from `Retry-After`. */
  readonly retryAfterMs?: number;
  readonly isRetryable = true;

  constructor({
    provider,
    retryAfterMs,
    message,
    cause,
  }: {
    provider: string;
    retryAfterMs?: number;
    message?: string;
    cause?: unknown;
  }) {
    super({
      name,
      message:
        message ??
        `Provider "${provider}" rate limited the request. ${
          retryAfterMs != null
            ? `Retry after ${retryAfterMs} ms.`
            : 'Retry later or reduce the request rate.'
        }`,
      cause,
    });
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }

  static override isInstance(error: unknown): error is RateLimitError {
    return CalsdkError.hasMarker(error, marker);
  }
}
