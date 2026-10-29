import { CalsdkError } from './calsdk-error';

const name = 'PermissionDeniedError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/** The token is valid but not allowed to do this (HTTP 403 that is not a rate limit). */
export class PermissionDeniedError extends CalsdkError {
  private readonly [symbol] = true;

  readonly provider: string;

  constructor({
    provider,
    message,
    cause,
  }: { provider: string; message?: string; cause?: unknown }) {
    super({
      name,
      message:
        message ??
        `Provider "${provider}" denied the request. Check that the token was granted the required OAuth scopes and that the user can access this calendar.`,
      cause,
    });
    this.provider = provider;
  }

  static override isInstance(error: unknown): error is PermissionDeniedError {
    return CalsdkError.hasMarker(error, marker);
  }
}
