import { CalsdkError } from './calsdk-error';

const name = 'APICallError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/**
 * A provider API call failed and no more specific error applies.
 *
 * Request headers are never stored: they carry the access token.
 */
export class APICallError extends CalsdkError {
  private readonly [symbol] = true;

  readonly url: string;
  /** Missing when the request never got a response (network failure, timeout). */
  readonly statusCode?: number;
  readonly responseHeaders?: Record<string, string>;
  readonly responseBody?: string;
  /** Whether retrying the same request may succeed. Core only retries when this is `true`. */
  readonly isRetryable: boolean;

  constructor({
    message,
    url,
    statusCode,
    responseHeaders,
    responseBody,
    cause,
    isRetryable = statusCode != null &&
      (statusCode === 408 || statusCode === 429 || statusCode >= 500),
  }: {
    message: string;
    url: string;
    statusCode?: number;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
    cause?: unknown;
    isRetryable?: boolean;
  }) {
    super({ name, message, cause });
    this.url = url;
    this.statusCode = statusCode;
    this.responseHeaders = responseHeaders;
    this.responseBody = responseBody;
    this.isRetryable = isRetryable;
  }

  static override isInstance(error: unknown): error is APICallError {
    return CalsdkError.hasMarker(error, marker);
  }
}
