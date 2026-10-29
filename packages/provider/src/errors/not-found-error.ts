import { CalsdkError } from './calsdk-error';

const name = 'NotFoundError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/** The calendar or event does not exist, was deleted, or is not visible to the user. */
export class NotFoundError extends CalsdkError {
  private readonly [symbol] = true;

  readonly provider: string;
  readonly resource: 'calendar' | 'event';
  readonly id: string;

  constructor({
    provider,
    resource,
    id,
    message,
    cause,
  }: {
    provider: string;
    resource: 'calendar' | 'event';
    id: string;
    message?: string;
    cause?: unknown;
  }) {
    super({
      name,
      message:
        message ??
        `The ${resource} "${id}" was not found on provider "${provider}". It may have been deleted, or the user cannot access it.`,
      cause,
    });
    this.provider = provider;
    this.resource = resource;
    this.id = id;
  }

  static override isInstance(error: unknown): error is NotFoundError {
    return CalsdkError.hasMarker(error, marker);
  }
}
