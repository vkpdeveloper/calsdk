import {
  type CallOptionsV1,
  InvalidArgumentError,
  NoSuchProviderVersionError,
  type ResultBaseV1,
} from '@calsdk/provider';
import type { CallSettings, ResultMetadata } from '../types';
import { logWarnings } from './log-warnings';
import { type RetryPolicy, withRetries } from './retry';

/** Throws unless `calendar` is a provider implementing a contract version core knows. */
export function assertProvider(calendar: unknown): asserts calendar is CallSettings['calendar'] {
  if (typeof calendar !== 'object' || calendar === null || !('specificationVersion' in calendar)) {
    throw new InvalidArgumentError({
      argument: 'calendar',
      message:
        'Pass a provider instance, for example `calendar: google({ accessToken })` or `calendar: mockCalendar()`.',
    });
  }
  if (calendar.specificationVersion !== 'v1') {
    throw new NoSuchProviderVersionError({
      provider: 'provider' in calendar ? String(calendar.provider) : 'unknown',
      version: String(calendar.specificationVersion),
    });
  }
}

/**
 * Validates the provider, then calls `fn` with the shared `do*` options,
 * retrying per policy and logging the result's warnings.
 */
export async function runCall<Result extends ResultBaseV1>(
  settings: CallSettings,
  operation: string,
  retryOn: RetryPolicy['retryOn'],
  fn: (callOptions: CallOptionsV1, attempt: number) => PromiseLike<Result>,
): Promise<Result> {
  assertProvider(settings.calendar);
  const maxRetries = settings.maxRetries ?? 2;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new InvalidArgumentError({
      argument: 'maxRetries',
      message: 'maxRetries must be a non-negative integer.',
    });
  }

  const callOptions: CallOptionsV1 = {
    abortSignal: settings.abortSignal,
    headers: settings.headers,
    providerOptions: settings.providerOptions,
  };
  const result = await withRetries(
    { maxRetries, abortSignal: settings.abortSignal, retryOn },
    (attempt) => Promise.resolve(fn(callOptions, attempt)),
  );
  logWarnings(result.warnings, { provider: settings.calendar.provider, operation });
  return result;
}

/** The result fields every calsdk function returns. */
export function resultMetadata(result: ResultBaseV1): ResultMetadata {
  return {
    warnings: result.warnings,
    providerMetadata: result.providerMetadata,
    response: result.response,
  };
}
