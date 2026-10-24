// Server-only token service shared by Vercel and the local voice launcher.
export function createTokenHandler(options: {
  getKey: () => string | undefined;
  fetcher?: typeof fetch;
  now?: () => number;
  limit?: number;
  windowMs?: number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const limit = options.limit ?? 30;
  const windowMs = options.windowMs ?? 60000;
  let windowStart = now();
  let count = 0;
  function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
    return Response.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
    });
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET')
      return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
    const origin = request.headers.get('origin');
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    ) {
      return json({ error: 'Cross-origin token requests are not allowed.' }, 403);
    }
    const key = options.getKey();
    if (!key?.trim())
      return json({ error: 'Cartesia API key is not configured on the server.' }, 503);
    const time = now();
    if (time - windowStart >= windowMs) {
      windowStart = time;
      count = 0;
    }
    if (count >= limit)
      return json({ error: 'Too many token requests. Try again shortly.' }, 429, {
        'Retry-After': String(Math.max(1, Math.ceil((windowStart + windowMs - time) / 1000))),
      });
    count++;
    try {
      const response = await fetcher('https://api.cartesia.ai/access-token', {
        method: 'POST',
        headers: {
          'X-API-Key': key,
          'Cartesia-Version': '2026-08-14',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ grants: { tts: true, stt: true }, expires_in: 300 }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const status = [401, 402, 429].includes(response.status) ? response.status : 502;
        return json(
          { error: 'Cartesia rejected the token request.', upstreamStatus: response.status },
          status,
        );
      }
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !('token' in body) ||
        typeof body.token !== 'string' ||
        !body.token.trim()
      ) {
        return json({ error: 'Cartesia returned an invalid token response.' }, 502);
      }
      return json({ token: body.token });
    } catch {
      // Never return upstream errors: they may contain headers or credentials.
      return json({ error: 'Unable to reach Cartesia. Try again shortly.' }, 502);
    }
  };
}
