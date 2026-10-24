import { describe, expect, it, vi } from 'vitest';
import { createTokenHandler } from './tokenEndpoint.ts';
import { GET } from '../../api/cartesia-token.ts';

const url = 'https://demo.example/api/cartesia-token';
const request = () => new Request(url);
const secret = 'test-server-secret';
function setup(response = Response.json({ token: 'temporary-token', extra: secret })) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const handler = createTokenHandler({ getKey: () => secret, fetcher });
  return { fetcher, handler };
}
describe('Cartesia token endpoint', () => {
  it('requests only speech grants for five minutes and returns only the token', async () => {
    const { handler, fetcher } = setup();
    const result = await handler(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ token: 'temporary-token' });
    expect(result.headers.get('cache-control')).toBe('no-store');
    const [destination, init] = fetcher.mock.calls[0]!;
    expect(destination).toBe('https://api.cartesia.ai/access-token');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('X-API-Key')).toBe(secret);
    expect(JSON.parse(String(init?.body))).toEqual({
      grants: { tts: true, stt: true },
      expires_in: 300,
    });
  });
  it('rejects unsupported methods and cross-origin requests without calling Cartesia', async () => {
    const { handler, fetcher } = setup();
    const post = await handler(new Request(url, { method: 'POST' }));
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    expect(
      (await handler(new Request(url, { headers: { origin: 'https://other.example' } }))).status,
    ).toBe(403);
    expect(
      (await handler(new Request(url, { headers: { 'sec-fetch-site': 'cross-site' } }))).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('allows the same origin', async () => {
    const { handler } = setup();
    expect(
      (await handler(new Request(url, { headers: { origin: 'https://demo.example' } }))).status,
    ).toBe(200);
  });
  it('fails safely if the key is missing, including through the Vercel entry point', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect((await createTokenHandler({ getKey: () => undefined, fetcher })(request())).status).toBe(
      503,
    );
    expect(fetcher).not.toHaveBeenCalled();
    const previous = process.env.CARTESIA_API_KEY;
    delete process.env.CARTESIA_API_KEY;
    try {
      expect((await GET(request())).status).toBe(503);
    } finally {
      if (previous !== undefined) process.env.CARTESIA_API_KEY = previous;
    }
  });
  it('limits requests and permits requests again after the window', async () => {
    let time = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ token: 'temporary' }));
    const handler = createTokenHandler({
      getKey: () => secret,
      fetcher,
      now: () => time,
      limit: 2,
    });
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request())).status).toBe(200);
    const denied = await handler(request());
    expect(denied.status).toBe(429);
    expect(denied.headers.get('retry-after')).toBe('60');
    expect(fetcher).toHaveBeenCalledTimes(2);
    time = 60000;
    expect((await handler(request())).status).toBe(200);
  });
  it.each([401, 402, 429, 500])('hides upstream error bodies for HTTP %s', async (status) => {
    const { handler } = setup(Response.json({ error: secret }, { status }));
    const result = await handler(request());
    expect(result.status).toBe(status === 500 ? 502 : status);
    expect(await result.text()).not.toContain(secret);
  });
  it.each([{}, { token: '' }, { token: 10 }])(
    'rejects malformed token responses: %j',
    async (body) => {
      const { handler } = setup(Response.json(body));
      expect((await handler(request())).status).toBe(502);
    },
  );
  it('hides network errors and supplies an upstream timeout signal', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(secret));
    const handler = createTokenHandler({ getKey: () => secret, fetcher });
    const result = await handler(request());
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain(secret);
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
