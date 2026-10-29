import { CalsdkError } from './calsdk-error';

const name = 'NoSuchProviderVersionError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/** The provider implements a contract version this version of calsdk does not know. */
export class NoSuchProviderVersionError extends CalsdkError {
  private readonly [symbol] = true;

  readonly provider: string;
  readonly version: string;

  constructor({ provider, version }: { provider: string; version: string }) {
    super({
      name,
      message: `Provider "${provider}" implements specification version "${version}", but this version of calsdk only supports "v1". Install versions of calsdk and the provider package that match.`,
    });
    this.provider = provider;
    this.version = version;
  }

  static override isInstance(error: unknown): error is NoSuchProviderVersionError {
    return CalsdkError.hasMarker(error, marker);
  }
}
