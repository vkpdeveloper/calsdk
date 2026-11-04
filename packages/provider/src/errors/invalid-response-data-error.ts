import { CalsdkError } from './calsdk-error';

const name = 'InvalidResponseDataError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/**
 * The provider returned data that does not match the expected shape.
 *
 * The message never includes the data itself (it can contain personal
 * information): read `data` when debugging.
 */
export class InvalidResponseDataError extends CalsdkError {
  private readonly [symbol] = true;

  readonly data: unknown;

  constructor({
    data,
    message = 'The provider returned data in an unexpected shape. This is likely a calsdk bug: please report it with `error.data` redacted.',
    cause,
  }: {
    data: unknown;
    message?: string;
    cause?: unknown;
  }) {
    super({ name, message, cause });
    this.data = data;
  }

  static override isInstance(error: unknown): error is InvalidResponseDataError {
    return CalsdkError.hasMarker(error, marker);
  }
}
