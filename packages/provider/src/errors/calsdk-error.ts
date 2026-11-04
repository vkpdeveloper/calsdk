const marker = 'calsdk.error';
const symbol = Symbol.for(marker);

/**
 * Base class of every error calsdk throws.
 *
 * Use the static `isInstance` checks instead of `instanceof`: they work even
 * when an app ends up with two copies of `@calsdk/provider` installed.
 *
 * @example
 * if (NotFoundError.isInstance(error)) { ... }
 */
export class CalsdkError extends Error {
  private readonly [symbol] = true;

  override readonly cause?: unknown;

  constructor({ name, message, cause }: { name: string; message: string; cause?: unknown }) {
    super(message);
    this.name = name;
    this.cause = cause;
  }

  static isInstance(error: unknown): error is CalsdkError {
    return CalsdkError.hasMarker(error, marker);
  }

  protected static hasMarker(error: unknown, marker: string): boolean {
    const markerSymbol = Symbol.for(marker);
    return (
      error != null &&
      typeof error === 'object' &&
      markerSymbol in error &&
      (error as Record<symbol, unknown>)[markerSymbol] === true
    );
  }
}
