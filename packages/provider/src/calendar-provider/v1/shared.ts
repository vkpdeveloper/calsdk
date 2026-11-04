import type { JSONObject } from '../../json-value';

/**
 * Provider-specific input, keyed by provider id.
 *
 * Providers only read their own key and ignore the rest, so one options object
 * can carry settings for several providers.
 *
 * @example
 * { google: { conferenceDataVersion: 1 }, microsoft: { transactionId: 'abc' } }
 */
export type ProviderOptionsV1 = Record<string, JSONObject | undefined>;

/**
 * Provider-specific output, keyed by provider id.
 *
 * @example
 * { microsoft: { showAs: 'oof' } }
 */
export type ProviderMetadataV1 = Record<string, JSONObject>;

/**
 * A non-fatal problem with a call. The call still succeeded.
 *
 * - `unsupported`: the provider ignored part of the request it cannot honor.
 * - `compatibility`: core or the provider used a fallback that may behave slightly differently.
 * - `other`: anything else worth surfacing to the developer.
 */
export type WarningV1 =
  | { type: 'unsupported'; feature: string; details?: string }
  | { type: 'compatibility'; feature: string; details?: string }
  | { type: 'other'; message: string };

/** Options every `do*` call accepts. */
export type CallOptionsV1 = {
  /** Cancels the in-flight request. Providers must pass it to `fetch`. */
  abortSignal?: AbortSignal;
  /** Extra HTTP headers for this call. `undefined` values are dropped. */
  headers?: Record<string, string | undefined>;
  providerOptions?: ProviderOptionsV1;
};

/** Fields every `do*` result carries. */
export type ResultBaseV1 = {
  warnings: WarningV1[];
  providerMetadata?: ProviderMetadataV1;
  /** Raw response information, for debugging only. Do not build logic on it. */
  response?: {
    headers?: Record<string, string>;
    body?: unknown;
  };
};
