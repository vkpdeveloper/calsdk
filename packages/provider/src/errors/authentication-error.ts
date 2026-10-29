import { CalsdkError } from './calsdk-error';

const name = 'AuthenticationError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/** The provider rejected the access token (HTTP 401): it is invalid, expired or revoked. */
export class AuthenticationError extends CalsdkError {
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
        `Provider "${provider}" rejected the access token. Refresh the token (or ask the user to reconnect the account) and retry.`,
      cause,
    });
    this.provider = provider;
  }

  static override isInstance(error: unknown): error is AuthenticationError {
    return CalsdkError.hasMarker(error, marker);
  }
}
