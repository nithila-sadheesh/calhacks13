const MESSAGES = {
  loading: 'Voice is still loading. Wait a moment, then try again.',
  audio:
    'Browser audio could not start. Click Enable replay sound again and check browser sound permissions.',
  tokenNetwork:
    'Could not reach the local Cartesia token endpoint. Check the dev server and connection.',
  tokenKey:
    'The Cartesia server key is missing. Configure CARTESIA_API_KEY and restart the dev server.',
  tokenAuth: 'Cartesia rejected the server key. Check CARTESIA_API_KEY and restart the dev server.',
  tokenRate: 'Cartesia token requests are temporarily rate limited. Wait a minute, then retry.',
  tokenInvalid: 'The Cartesia token endpoint returned an invalid response.',
  tokenHttp: 'The Cartesia token endpoint failed. Check the server configuration and retry.',
  connection:
    'Browser sound is unlocked, but the Cartesia voice connection failed. Check the network and retry.',
  timeout:
    'Browser sound is unlocked, but the Cartesia voice connection timed out. Retry the connection.',
  stopped: 'The voice session was reset while connecting. Try again.',
} as const;
export class VoiceSetupError extends Error {
  constructor(code: keyof typeof MESSAGES) {
    super(MESSAGES[code]);
    this.name = 'VoiceSetupError';
  }
}
export function voiceSetupMessage(error: unknown): string {
  return error instanceof VoiceSetupError
    ? error.message
    : 'Sound setup failed. Check browser sound permissions and the voice connection, then retry.';
}
