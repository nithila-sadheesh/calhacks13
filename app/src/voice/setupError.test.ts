import { expect, it } from 'vitest';
import { VoiceSetupError, voiceSetupMessage } from './setupError.ts';
it('only exposes controlled setup errors and never echoes arbitrary network errors', () => {
  expect(voiceSetupMessage(new VoiceSetupError('tokenAuth'))).toContain('rejected the server key');
  expect(voiceSetupMessage(new Error('wss://private.example/?access_token=secret'))).not.toContain(
    'secret',
  );
  expect(voiceSetupMessage(new VoiceSetupError('timeout'))).toContain('timed out');
});
