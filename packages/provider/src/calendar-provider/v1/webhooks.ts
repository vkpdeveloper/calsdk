import type { CallOptionsV1, ProviderMetadataV1 } from './shared';

// Webhook shapes are part of the v1 contract so providers can plan for them,
// but no provider or core function implements them yet.

export type SubscribeOptionsV1 = CallOptionsV1 & {
  calendarId: string;
  /** Public HTTPS URL the provider will POST notifications to. */
  webhookUrl: string;
  /** Requested ISO 8601 expiry. Providers may cap it, check `SubscriptionV1.expiresAt`. */
  expiresAt?: string;
  /** Secret echoed back in notifications so the app can verify their origin. */
  clientState?: string;
};

/** A webhook subscription. Plain data: the app stores it and passes it back to renew or cancel. */
export type SubscriptionV1 = {
  id: string;
  calendarId: string;
  /** ISO 8601. */
  expiresAt: string;
  /** Provider-side resource id, needed by some providers to cancel. */
  resourceId?: string;
  providerMetadata?: ProviderMetadataV1;
};

export type RenewSubscriptionOptionsV1 = CallOptionsV1 & {
  subscription: SubscriptionV1;
  /** Requested ISO 8601 expiry. */
  expiresAt?: string;
};

export type UnsubscribeOptionsV1 = CallOptionsV1 & {
  subscription: SubscriptionV1;
};

export type ParseWebhookOptionsV1 = {
  /** The `clientState` used when subscribing. Notifications that do not match are ignored. */
  clientState?: string;
};

/**
 * - `validation`: the provider is verifying the endpoint. Return `response` as-is.
 * - `changed`: something changed. Run `syncEvents` for the calendar.
 * - `ignored`: not a notification for this app.
 */
export type WebhookResultV1 =
  | { type: 'validation'; response: Response }
  | { type: 'changed'; subscriptionId: string; calendarId?: string }
  | { type: 'ignored' };
