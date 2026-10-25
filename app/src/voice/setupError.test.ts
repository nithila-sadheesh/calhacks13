import { expect, it } from 'vitest';
import { VoiceSetupError, voiceSetupMessage, microphoneSetupMessage } from './setupError.ts';
it('only exposes controlled setup errors and never echoes arbitrary network errors', () => {
  expect(voiceSetupMessage(new VoiceSetupError('tokenAuth'))).toContain('rejected the server key');
  expect(voiceSetupMessage(new Error('wss://private.example/?access_token=secret'))).not.toContain(
    'secret',
  );
  expect(voiceSetupMessage(new VoiceSetupError('timeout'))).toContain('timed out');
});

it('distinguishes blocked, missing and unavailable microphones without exposing arbitrary errors', () => {
  expect(microphoneSetupMessage(new DOMException('private', 'NotAllowedError'))).toContain(
    'permission is blocked',
  );
  expect(microphoneSetupMessage(new DOMException('private', 'NotFoundError'))).toContain(
    'No microphone',
  );
  expect(microphoneSetupMessage(new DOMException('private', 'NotReadableError'))).toContain(
    'selected input',
  );
  expect(microphoneSetupMessage(new Error('private'))).not.toContain('private');
  expect(microphoneSetupMessage(new VoiceSetupError('tokenKey'))).toContain('CARTESIA_API_KEY');
});
