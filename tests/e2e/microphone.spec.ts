import { expect, test } from '@playwright/test';

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone', 'camera'],
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

test('shows a missing Preview Cartesia key for speech and microphone failures', async ({
  page,
}) => {
  await page.route('**/api/cartesia-token', (route) =>
    route.fulfill({ status: 503, json: { error: 'not configured' } }),
  );
  await page.goto('/?mock=map,vision,assistant');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await expect(page.locator('.panel [role=alert]')).toContainText('CARTESIA_API_KEY');
  await page.getByRole('button', { name: 'Enable replay sound' }).click();
  await page.locator('.mic-orb').click();
  await expect(page.locator('.dock [role=alert]')).toContainText('CARTESIA_API_KEY');
});

test('distinguishes microphone permission denial from a provider failure', async ({ page }) => {
  await page.route('**/api/cartesia-token', (route) =>
    route.fulfill({ json: { token: 'test-token' } }),
  );
  await page.routeWebSocket('**/tts/websocket?*', () => {});
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('private detail', 'NotAllowedError');
    };
  });
  await page.goto('/?mock=map,vision,assistant');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await page.getByRole('button', { name: 'Enable replay sound' }).click();
  await page.locator('.mic-orb').click();
  await expect(page.locator('.dock [role=alert]')).toContainText(
    'Microphone permission is blocked',
  );
  await expect(page.locator('.dock [role=alert]')).not.toContainText('private detail');
});

test('generated instructions reach real browser audio playback through Sonic', async ({ page }) => {
  await page.route('**/api/cartesia-token', (route) =>
    route.fulfill({ json: { token: 'test-token' } }),
  );
  const audio = Buffer.alloc(9600);
  for (let i = 0; i < 4800; i++)
    audio.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / 24000) * 2000), i * 2);
  const spoken: string[] = [];
  await page.routeWebSocket('**/tts/websocket?*', (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== 'string') return;
      const request = JSON.parse(message) as {
        context_id?: string;
        transcript?: string;
        cancel?: boolean;
      };
      if (!request.transcript || !request.context_id || request.cancel) return;
      spoken.push(request.transcript);
      socket.send(
        JSON.stringify({
          type: 'chunk',
          context_id: request.context_id,
          data: audio.toString('base64'),
        }),
      );
      socket.send(JSON.stringify({ type: 'done', context_id: request.context_id }));
    });
  });
  await page.goto('/?mock=map,vision,assistant');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await page.getByRole('button', { name: 'Enable replay sound' }).click();
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => spoken.length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect(page.getByText(/^First audible: \d+ ms$/)).toBeVisible();
  await expect(page.locator('.panel [role=alert]')).toHaveCount(0);
});

test('a user interruption stops guidance, gets an answer, and does not resume the old sentence', async ({
  page,
}) => {
  await page.route('**/api/cartesia-token', (route) =>
    route.fulfill({ json: { token: 'test-token' } }),
  );
  const answer = 'Check both sides and keep the sign in view.';
  await page.route('**/api/assistant', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      mode: 'answer',
      question: 'What does that sign mean?',
    });
    await route.fulfill({ json: { text: answer } });
  });
  const lines: Array<{ id: string; text: string }> = [];
  const cancelled: string[] = [];
  await page.routeWebSocket('**/tts/websocket?*', (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== 'string') return;
      const request = JSON.parse(message) as {
        context_id?: string;
        transcript?: string;
        cancel?: boolean;
      };
      if (!request.context_id) return;
      if (request.cancel) {
        cancelled.push(request.context_id);
        return;
      }
      if (!request.transcript) return;
      lines.push({ id: request.context_id, text: request.transcript });
      // Guidance would last ten seconds without interruption; the answer is short.
      const samples = request.transcript === answer ? 4800 : 240000;
      const audio = Buffer.alloc(samples * 2);
      for (let i = 0; i < samples; i++)
        audio.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / 24000) * 1000), i * 2);
      socket.send(
        JSON.stringify({
          type: 'chunk',
          context_id: request.context_id,
          data: audio.toString('base64'),
        }),
      );
      socket.send(JSON.stringify({ type: 'done', context_id: request.context_id }));
    });
  });
  await page.routeWebSocket('**/stt/websocket?*', (socket) => {
    socket.onMessage((message) => {
      if (message !== 'finalize') return;
      socket.send(
        JSON.stringify({ type: 'transcript', is_final: true, text: 'What does that sign mean?' }),
      );
      socket.send(JSON.stringify({ type: 'flush_done' }));
    });
  });
  await page.goto('/?mock=map,vision');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start live drive' }).click();
  await page.getByRole('button', { name: 'Start drive' }).click();
  await expect(page.getByRole('button', { name: 'End drive' })).toBeVisible();
  await expect.poll(() => lines.length, { timeout: 8000 }).toBe(1);
  await expect(page.getByText(/^First audible: \d+ ms$/)).toBeVisible();
  const orb = page.locator('.mic-orb');
  const bounds = await orb.boundingBox();
  if (!bounds) throw new Error('Microphone button is not visible');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  // The cancellation must arrive while the button is still held, before pointer-up/click.
  await expect.poll(() => cancelled).toContain(lines[0]!.id);
  await expect(orb).toHaveAccessibleName('Listening… tap to send');
  await page.mouse.up();
  await expect(orb).toHaveAccessibleName('Listening… tap to send');
  await expect(page.locator('.captions p')).toHaveText('Spoken lines appear here.');
  await orb.click();
  await expect
    .poll(() => lines.map((line) => line.text))
    .toEqual(['Stop sign ahead. Prepare for a complete stop.', answer]);
  await page.waitForTimeout(3500);
  expect(lines.map((line) => line.text)).toEqual([
    'Stop sign ahead. Prepare for a complete stop.',
    answer,
  ]);
  await page.getByRole('button', { name: 'End drive' }).click();
});
