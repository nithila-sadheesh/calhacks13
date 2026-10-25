import { afterEach, expect, it, vi } from 'vitest';
import { fetchCartesiaToken } from './token.ts';

afterEach(() => vi.unstubAllGlobals());
it.each([
  [503, 'key is missing'],
  [401, 'rejected the server key'],
  [402, 'billing or credits'],
  [429, 'rate limited'],
  [500, 'endpoint failed'],
])('reports a safe actionable message for HTTP %s', async (status, message) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ token: 'private', error: 'private' }, { status })),
  );
  await expect(fetchCartesiaToken(new AbortController().signal)).rejects.toThrow(String(message));
  await expect(fetchCartesiaToken(new AbortController().signal)).rejects.not.toThrow('private');
});
it('does not expose a rejected network URL or malformed token response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValueOnce(new Error('https://private/?access_token=secret')),
  );
  await expect(fetchCartesiaToken(new AbortController().signal)).rejects.toThrow('Could not reach');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ token: ' ' })),
  );
  await expect(fetchCartesiaToken(new AbortController().signal)).rejects.toThrow(
    'invalid response',
  );
});
