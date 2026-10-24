import { expect, test } from '@playwright/test';
import type { Events } from '../../shared/types.ts';

test('live recorded replay measures Claude coaching and Cartesia playback', async ({ page }) => {
  test.skip(process.env.LIVE_RUNTIME_CHECK !== '1', 'Opt-in live Claude and Cartesia requests.');
  const advice: Events['visionAdvice'][] = [];
  const speech: Events['speak'][] = [];
  const audible: Events['speechStarted'][] = [];
  const ended: Events['speechEnded'][] = [];
  const responses: Array<{ status: number; latencyMs: number; result?: unknown }> = [];
  const tokenStatuses: number[] = [];
  const sockets: Array<{ receivedTypes: string[]; closed: boolean; error: boolean }> = [];
  page.on('websocket', (socket) => {
    const info = { receivedTypes: [] as string[], closed: false, error: false };
    sockets.push(info);
    socket.on('framereceived', (frame) => {
      try {
        const message = JSON.parse(String(frame.payload)) as { type?: string };
        if (message.type) info.receivedTypes.push(message.type);
      } catch {
        /* binary audio is not logged */
      }
    });
    socket.on('close', () => {
      info.closed = true;
    });
    socket.on('socketerror', () => {
      info.error = true;
    });
  });
  const starts = new WeakMap<object, number>();
  const scenes: unknown[] = [];
  const observations: Promise<void>[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/vision-advice')) {
      starts.set(request, performance.now());
      const input = request.postDataJSON() as { scene?: unknown; frames?: unknown };
      if (input.scene) scenes.push(input.scene);
      expect(input.frames).toBeUndefined();
    }
  });
  page.on('response', (response) => {
    if (response.url().endsWith('/api/cartesia-token')) tokenStatuses.push(response.status());
    if (response.url().endsWith('/api/vision-advice'))
      observations.push(
        (async () => {
          const result: unknown = await response.json().catch(() => undefined);
          responses.push({
            status: response.status(),
            latencyMs: Math.round(
              performance.now() - (starts.get(response.request()) ?? performance.now()),
            ),
            result,
          });
        })(),
      );
  });
  page.on('console', (message) => {
    const kind = message
      .text()
      .match(/^\[bus\] (visionAdvice|speak|speechStarted|speechEnded)\b/)?.[1];
    if (!kind) return;
    observations.push(
      (async () => {
        const value: unknown = await message.args()[1]?.jsonValue();
        if (!value) return;
        if (kind === 'visionAdvice') advice.push(value as Events['visionAdvice']);
        if (kind === 'speak') speech.push(value as Events['speak']);
        if (kind === 'speechStarted') audible.push(value as Events['speechStarted']);
        if (kind === 'speechEnded') ended.push(value as Events['speechEnded']);
      })(),
    );
  });
  await page.goto('/');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await page.getByRole('button', { name: 'Enable replay sound' }).click();
  await expect(page.locator('video'))
    .toHaveJSProperty('controls', true, { timeout: 15000 })
    .catch((error) => {
      console.log('Voice connection status:', JSON.stringify({ tokenStatuses, sockets }));
      throw error;
    });
  await expect(page.locator('video')).toHaveJSProperty('readyState', 4);
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
  await expect(page.locator('video')).toHaveJSProperty('ended', true, { timeout: 25000 });
  await page.screenshot({ path: '/private/tmp/calhacks13-live-replay.png' });
  await Promise.allSettled(observations);
  console.log(
    'Live replay measurements:',
    JSON.stringify({ responses, scenes, advice, speech, audible, ended, tokenStatuses }),
  );
  expect(responses.some((response) => response.status === 200)).toBe(true);
  // Silence is a valid model decision; require audio only when the arbiter requests it.
  if (speech.some((request) => request.origin === 'vision'))
    expect(audible.length).toBeGreaterThan(0);
});

test('live sound setup connects without sending frames or speech', async ({ page }) => {
  test.skip(process.env.LIVE_SOUND_CHECK !== '1', 'Opt-in Cartesia connection check only.');
  await page.goto('/?mock=vision');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await page.getByRole('button', { name: 'Enable replay sound' }).click();
  await expect(page.locator('video')).toHaveJSProperty('controls', true, { timeout: 15000 });
  await expect(page.getByText('Sound enabled for replay.', { exact: true })).toBeVisible();
});
