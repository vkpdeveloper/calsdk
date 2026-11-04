import { CalsdkError } from './calsdk-error';

const name = 'UnsupportedFunctionalityError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/** The provider cannot do this and calsdk has no fallback. Check `provider.capabilities` first. */
export class UnsupportedFunctionalityError extends CalsdkError {
  private readonly [symbol] = true;

  readonly provider: string;
  readonly functionality: string;

  constructor({
    provider,
    functionality,
    message,
  }: {
    provider: string;
    functionality: string;
    message?: string;
  }) {
    super({
      name,
      message: message ?? `Provider "${provider}" does not support ${functionality}.`,
    });
    this.provider = provider;
    this.functionality = functionality;
  }

  static override isInstance(error: unknown): error is UnsupportedFunctionalityError {
    return CalsdkError.hasMarker(error, marker);
  }
}
