import { CalsdkError } from './calsdk-error';

const name = 'InvalidArgumentError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/** An argument is invalid. Thrown before any request is sent. */
export class InvalidArgumentError extends CalsdkError {
  private readonly [symbol] = true;

  readonly argument: string;

  constructor({
    argument,
    message,
    cause,
  }: { argument: string; message: string; cause?: unknown }) {
    super({ name, message: `Invalid argument "${argument}": ${message}`, cause });
    this.argument = argument;
  }

  static override isInstance(error: unknown): error is InvalidArgumentError {
    return CalsdkError.hasMarker(error, marker);
  }
}
