import { CalsdkError } from './calsdk-error';

const name = 'SyncCursorExpiredError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/**
 * The stored sync cursor is no longer valid. The app must discard it and run a full sync.
 * The default message leaves out `calendarId`, since calendar ids are often email addresses.
 */
export class SyncCursorExpiredError extends CalsdkError {
  private readonly [symbol] = true;

  readonly provider: string;
  readonly calendarId: string;

  constructor({
    provider,
    calendarId,
    message,
    cause,
  }: {
    provider: string;
    calendarId: string;
    message?: string;
    cause?: unknown;
  }) {
    super({
      name,
      message:
        message ??
        `Provider "${provider}" rejected the sync cursor. Discard the stored cursor and call syncEvents() without a cursor to run a full sync.`,
      cause,
    });
    this.provider = provider;
    this.calendarId = calendarId;
  }

  static override isInstance(error: unknown): error is SyncCursorExpiredError {
    return CalsdkError.hasMarker(error, marker);
  }
}
