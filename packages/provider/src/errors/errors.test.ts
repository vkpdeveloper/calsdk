import { describe, expect, it } from 'vitest';
import { APICallError } from './api-call-error';
import { CalsdkError } from './calsdk-error';
import { NotFoundError } from './not-found-error';
import { RateLimitError } from './rate-limit-error';

describe('isInstance', () => {
  it('matches the class and its base, not siblings', () => {
    const error = new NotFoundError({ provider: 'google', resource: 'event', id: 'e1' });

    expect(NotFoundError.isInstance(error)).toBe(true);
    expect(CalsdkError.isInstance(error)).toBe(true);
    expect(APICallError.isInstance(error)).toBe(false);
  });

  it('matches errors created by another copy of the package', () => {
    // A duplicated package has its own class, but Symbol.for markers are global.
    const foreign = Object.assign(new Error('x'), {
      [Symbol.for('calsdk.error')]: true,
      [Symbol.for('calsdk.error.RateLimitError')]: true,
    });

    expect(RateLimitError.isInstance(foreign)).toBe(true);
    expect(CalsdkError.isInstance(foreign)).toBe(true);
  });

  it('rejects non-errors', () => {
    expect(CalsdkError.isInstance(null)).toBe(false);
    expect(CalsdkError.isInstance('CalsdkError')).toBe(false);
    expect(CalsdkError.isInstance({ name: 'CalsdkError' })).toBe(false);
  });
});

describe('APICallError', () => {
  it.each([
    [408, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [409, false],
    [undefined, false],
  ])('status %s is retryable: %s', (statusCode, isRetryable) => {
    expect(new APICallError({ message: 'x', url: 'https://x', statusCode }).isRetryable).toBe(
      isRetryable,
    );
  });
});
