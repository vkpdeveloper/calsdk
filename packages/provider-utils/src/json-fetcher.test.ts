import { APICallError, InvalidResponseDataError } from '@calsdk/provider';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createJsonFetcher, urlPath } from './json-fetcher';

function stubFetch(response: () => Response) {
  return vi.fn<typeof fetch>(async () => response());
}

describe('createJsonFetcher', () => {
  it('sends the token, headers, query and JSON body', async () => {
    const fetch = stubFetch(() => Response.json({ id: 'e1' }));
    const request = createJsonFetcher({
      baseURL: 'https://api.example.com/v3/',
      headers: { 'x-static': 'a' },
      accessToken: 'secret',
      fetch,
    });

    const { value } = await request({
      method: 'POST',
      path: urlPath`/calendars/${'a/b@c.com'}/events`,
      query: { maxResults: 10, skipped: undefined, many: ['x', 'y'] },
      body: { title: 'Hi' },
      headers: { 'x-call': 'b' },
      schema: z.object({ id: z.string() }),
    });

    expect(value).toEqual({ id: 'e1' });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://api.example.com/v3/calendars/a%2Fb%40c.com/events?maxResults=10&many=x&many=y',
    );
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      'x-static': 'a',
      'x-call': 'b',
    });
    expect(init?.body).toBe('{"title":"Hi"}');
  });

  it('resolves a token function on every request', async () => {
    let n = 0;
    const fetch = stubFetch(() => new Response(null, { status: 204 }));
    const request = createJsonFetcher({
      baseURL: 'https://api.example.com',
      accessToken: async () => `token-${++n}`,
      fetch,
    });

    await request({ method: 'DELETE', path: '/a' });
    await request({ method: 'DELETE', path: '/a' });

    const tokens = fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('authorization'),
    );
    expect(tokens).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('throws APICallError with the provider message and without the token', async () => {
    const request = createJsonFetcher({
      baseURL: 'https://api.example.com',
      accessToken: 'secret',
      fetch: stubFetch(() =>
        Response.json(
          { error: { message: 'Rate Limit Exceeded' } },
          { status: 503, headers: { 'Retry-After': '2' } },
        ),
      ),
    });

    const error = await request({ method: 'GET', path: '/a' }).catch((e: unknown) => e);

    expect(APICallError.isInstance(error)).toBe(true);
    const apiError = error as APICallError;
    expect(apiError.statusCode).toBe(503);
    expect(apiError.isRetryable).toBe(true);
    expect(apiError.message).toContain('Rate Limit Exceeded');
    expect(apiError.responseHeaders?.['retry-after']).toBe('2');
    expect(JSON.stringify({ ...apiError, message: apiError.message })).not.toContain('secret');
  });

  it('wraps network failures as retryable APICallError', async () => {
    const request = createJsonFetcher({
      baseURL: 'https://api.example.com',
      accessToken: 't',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });

    const error = await request({ method: 'GET', path: '/a' }).catch((e: unknown) => e);
    expect(APICallError.isInstance(error) && error.isRetryable).toBe(true);
  });

  it('rethrows abort errors unchanged', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = createJsonFetcher({
      baseURL: 'https://api.example.com',
      accessToken: 't',
      fetch: async (_url, init) => {
        init?.signal?.throwIfAborted();
        return Response.json({});
      },
    });

    const error = await request({
      method: 'GET',
      path: '/a',
      abortSignal: controller.signal,
    }).catch((e: unknown) => e);
    expect(error).toBe(controller.signal.reason);
  });

  it('throws InvalidResponseDataError when the body does not match the schema', async () => {
    const request = createJsonFetcher({
      baseURL: 'https://api.example.com',
      accessToken: 't',
      fetch: stubFetch(() => Response.json({ id: 42 })),
    });

    await expect(
      request({ method: 'GET', path: '/a', schema: z.object({ id: z.string() }) }),
    ).rejects.toSatisfy(InvalidResponseDataError.isInstance);
  });

  it('refuses to send the token to another origin', async () => {
    const fetch = stubFetch(() => Response.json({}));
    const request = createJsonFetcher({
      baseURL: 'https://graph.example.com/v1.0',
      accessToken: 't',
      fetch,
    });

    await expect(
      request({ method: 'GET', path: 'https://evil.example.com/steal' }),
    ).rejects.toSatisfy(InvalidResponseDataError.isInstance);
    await request({ method: 'GET', path: 'https://graph.example.com/v1.0/next?page=2' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
