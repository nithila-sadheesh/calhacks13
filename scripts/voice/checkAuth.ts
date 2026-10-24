// Prints authentication diagnostics only; never prints the key or returned access token.
import { readFile } from 'node:fs/promises';

const envText = await readFile('.env', 'utf8').catch(() => '');
const entries = envText.match(/^\s*(?:export\s+)?CARTESIA_API_KEY\s*=/gm) ?? [];
process.loadEnvFile('.env');
const key = process.env.CARTESIA_API_KEY ?? '';
console.log(
  JSON.stringify({
    envKeyEntries: entries.length,
    keyLoaded: Boolean(key),
    surroundingWhitespace: key !== key.trim(),
    containsWhitespace: /\s/.test(key),
    containsBearerPrefix: /^Bearer\s/i.test(key),
    containsQuoteCharacters: /["'“”‘’]/.test(key),
  }),
);
if (!key) process.exit(1);

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .split(key)
    .join('[redacted]')
    .replace(/(?:sk_car_|sk_|Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '[redacted]')
    .replace(/https?:\/\/\S+/g, '[URL omitted]')
    .slice(0, 500);
}
for (const endpoint of ['voices', 'access-token'] as const) {
  for (const auth of ['bearer', 'api-key'] as const) {
    try {
      const response = await fetch(`https://api.cartesia.ai/${endpoint}`, {
        method: endpoint === 'voices' ? 'GET' : 'POST',
        headers: {
          ...(auth === 'bearer' ? { Authorization: `Bearer ${key}` } : { 'X-API-Key': key }),
          'Cartesia-Version': '2026-08-14',
          'Content-Type': 'application/json',
        },
        body:
          endpoint === 'access-token'
            ? JSON.stringify({ grants: { tts: true, stt: true }, expires_in: 60 })
            : undefined,
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        console.log(`${endpoint} / ${auth}: succeeded (HTTP ${response.status}).`);
      } else {
        const body: unknown = await response.json().catch(() => null);
        const error = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        console.log(
          JSON.stringify({
            endpoint,
            auth,
            status: response.status,
            errorCode: safeText(error.error_code),
            title: safeText(error.title),
            message: safeText(error.message),
          }),
        );
      }
    } catch {
      console.log(
        'Could not reach Cartesia from this terminal. No authentication result available.',
      );
    }
  }
}
