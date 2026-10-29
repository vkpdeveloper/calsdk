import { CalsdkError } from './calsdk-error';

const name = 'ConflictError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/** The event changed since its `etag` was read, so a write with `ifMatch` was rejected (HTTP 412). */
export class ConflictError extends CalsdkError {
  private readonly [symbol] = true;

  readonly provider: string;
  readonly eventId: string;

  constructor({
    provider,
    eventId,
    message,
    cause,
  }: {
    provider: string;
    eventId: string;
    message?: string;
    cause?: unknown;
  }) {
    super({
      name,
      message:
        message ??
        `The event "${eventId}" on provider "${provider}" changed since its etag was read. Fetch the event again and retry with the new etag.`,
      cause,
    });
    this.provider = provider;
    this.eventId = eventId;
  }

  static override isInstance(error: unknown): error is ConflictError {
    return CalsdkError.hasMarker(error, marker);
  }
}
