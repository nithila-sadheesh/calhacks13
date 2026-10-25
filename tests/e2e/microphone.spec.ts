import { expect, test } from '@playwright/test';

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone'],
});

test('tap-to-talk keeps the full recording through a slow connection and sends it once', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        if (!options)
          (window as Window & { playbackContext?: AudioContext }).playbackContext = this;
      }
    };
  });
  let delayToken = false;
  let tokenCalls = 0;
  let releaseToken!: () => void;
  const tokenGate = new Promise<void>((resolve) => {
    releaseToken = resolve;
  });
  await page.route('**/api/cartesia-token', async (route) => {
    tokenCalls++;
    if (delayToken) await tokenGate;
    await route.fulfill({ json: { token: 'test-token' } });
  });
  await page.routeWebSocket('**/tts/websocket?*', () => {});
  let audioBytes = 0;
  let sampleRate = 0;
  let finalizations = 0;
  let releaseTranscript!: () => void;
  const transcriptGate = new Promise<void>((resolve) => {
    releaseTranscript = resolve;
  });
  await page.routeWebSocket('**/stt/websocket?*', (socket) => {
    sampleRate = Number(new URL(socket.url()).searchParams.get('sample_rate'));
    socket.onMessage((message) => {
      if (typeof message !== 'string') audioBytes += message.length;
      else if (message === 'finalize') {
        finalizations++;
        void transcriptGate.then(() => {
          socket.send(
            JSON.stringify({
              type: 'transcript',
              is_final: true,
              text: 'What does a yield sign mean?',
            }),
          );
          socket.send(JSON.stringify({ type: 'flush_done' }));
        });
      }
    });
  });
  await page.goto('/?mock=map,vision,assistant');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await page.getByRole('button', { name: 'Enable replay sound' }).click();
  await expect.poll(() => tokenCalls).toBe(1);
  delayToken = true;
  const orb = page.locator('.mic-orb');
  await orb.click();
  await expect(orb).toHaveAccessibleName('Listening… tap to send');
  // Simulate an Ink token request slower than the old three-second audio buffer.
  await page.waitForTimeout(4500);
  // Capture can interrupt the playback context (for example during an audio-session change).
  await page.evaluate(async () => {
    const context = (window as Window & { playbackContext?: AudioContext }).playbackContext;
    if (!context) throw new Error('Playback context was not created');
    await context.suspend();
  });
  await orb.click();
  await expect(orb).toHaveAccessibleName('Thinking…');
  await expect(orb).toBeDisabled();
  await expect(page.locator('.mic-button')).toBeDisabled();
  releaseToken();
  await expect.poll(() => finalizations).toBe(1);
  expect(audioBytes / 2 / sampleRate).toBeGreaterThan(4);
  releaseTranscript();
  await expect(page.locator('.assistant-q')).toContainText('What does a yield sign mean?');
  await expect(orb).toBeEnabled();
  expect(finalizations).toBe(1);
});
