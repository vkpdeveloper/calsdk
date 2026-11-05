import { z } from 'zod';

const tokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
});

/**
 * Trades an OAuth refresh token for access tokens, caching each one until a minute
 * before it expires. Concurrent calls share one refresh.
 */
export function refreshingToken(options: {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scope?: string;
  fetch?: typeof fetch;
}): () => Promise<string> {
  const fetchToken = options.fetch ?? fetch;
  // Microsoft can rotate the refresh token; keep the newest one.
  let refreshToken = options.refreshToken;
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  async function refresh() {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: options.clientId,
    });
    if (options.clientSecret) body.set('client_secret', options.clientSecret);
    if (options.scope) body.set('scope', options.scope);

    // Every caller waits on this one request, so a stalled token endpoint must not hold them.
    const response = await fetchToken(options.tokenUrl, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const json: unknown = await response.json().catch(() => undefined);
    const parsed = tokenResponse.safeParse(json);
    if (!response.ok || !parsed.success) {
      const reason = z.object({ error_description: z.string() }).safeParse(json);
      throw new Error(
        `Refreshing the access token at ${options.tokenUrl} failed (HTTP ${response.status})` +
          (reason.success ? `: ${reason.data.error_description}` : ''),
      );
    }

    if (parsed.data.refresh_token) refreshToken = parsed.data.refresh_token;
    const lifetimeMs = (parsed.data.expires_in ?? 3600) * 1000;
    cached = { token: parsed.data.access_token, expiresAt: Date.now() + lifetimeMs - 60_000 };
    return cached.token;
  }

  return () => {
    if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.token);
    pending ??= refresh().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
