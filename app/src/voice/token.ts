import { VoiceSetupError } from './setupError.ts';

// Report controlled errors only: upstream responses and token-bearing URLs stay private.
export async function fetchCartesiaToken(signal: AbortSignal): Promise<string> {
  const response = await fetch('/api/cartesia-token', {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  }).catch(() => {
    throw new VoiceSetupError('tokenNetwork');
  });
  if (!response.ok) {
    const code =
      response.status === 503
        ? 'tokenKey'
        : response.status === 401 || response.status === 403
          ? 'tokenAuth'
          : response.status === 402
            ? 'tokenBilling'
            : response.status === 429
              ? 'tokenRate'
              : 'tokenHttp';
    throw new VoiceSetupError(code);
  }
  const body: unknown = await response.json().catch(() => {
    throw new VoiceSetupError('tokenInvalid');
  });
  if (
    !body ||
    typeof body !== 'object' ||
    !('token' in body) ||
    typeof body.token !== 'string' ||
    !body.token.trim()
  )
    throw new VoiceSetupError('tokenInvalid');
  return body.token;
}
