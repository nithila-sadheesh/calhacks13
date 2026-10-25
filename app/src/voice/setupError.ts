const MESSAGES = {
  loading: 'Voice is still loading. Wait a moment, then try again.',
  audio:
    'Browser audio could not start. Click Enable replay sound again and check browser sound permissions.',
  tokenNetwork: 'Could not reach the Cartesia token endpoint. Check the deployment and connection.',
  tokenKey:
    'The Cartesia server key is missing. Configure CARTESIA_API_KEY for this deployment, then restart or redeploy.',
  tokenAuth:
    'Cartesia rejected the server key. Check CARTESIA_API_KEY for this deployment, then restart or redeploy.',
  tokenBilling:
    'Cartesia rejected the request because of billing or credits. Check the Cartesia account.',
  micConnection: 'The Cartesia speech recognition connection failed. Check the network and retry.',
  speech:
    'Speech could not be played. Check the Cartesia connection and enable browser sound, then retry.',
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

export function microphoneSetupMessage(error: unknown): string {
  if (error instanceof VoiceSetupError) return error.message;
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      return 'Microphone permission is blocked. Allow microphone access for this site in your browser settings and reload.';
    if (error.name === 'NotFoundError')
      return 'No microphone was found. Connect or enable a microphone and retry.';
    if (error.name === 'NotReadableError')
      return 'The microphone could not open. Check the selected input and close other apps using it.';
  }
  return 'Microphone capture failed. Check browser microphone permissions and the selected input, then retry.';
}
