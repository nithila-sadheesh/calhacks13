import { expect, test } from '@playwright/test';

test('video frames generate coaching through the real arbiter and speech events', async ({
  page,
}) => {
  const batches: Array<{ frames: Array<{ tripMs: number; jpeg: string }> }> = [];
  await page.route('**/api/vision-advice', async (route) => {
    batches.push(route.request().postDataJSON());
    await route.fulfill({
      json:
        batches.length === 1
          ? {
              shouldSpeak: true,
              message: 'Watch for cyclists beside parked cars.',
              reason: 'A cyclist is visible near parked vehicles.',
            }
          : { shouldSpeak: false, message: '', reason: 'No new useful observation.' },
    });
  });
  // Voice mock keeps this deterministic and avoids live Cartesia requests.
  await page.goto('/?mock=voice');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await expect(page.locator('video')).toHaveJSProperty('controls', true);
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
  await expect(page.locator('.captions')).toHaveText('Watch for cyclists beside parked cars.', {
    timeout: 10000,
  });
  expect(batches[0]?.frames.length).toBeGreaterThanOrEqual(2);
  expect(batches[0]?.frames[0]?.jpeg.startsWith('/9j/')).toBe(true);
  await expect(page.getByRole('region', { name: 'Timeline' })).toContainText('Video coaching');
  await expect(page.getByRole('region', { name: 'Data use' })).toContainText(
    'resized video frames',
  );
  await expect(page.getByRole('region', { name: 'Timeline' })).toContainText(
    'map shown for context only',
  );
  await expect(page.locator('.overlay')).toContainText('No new useful observation.', {
    timeout: 7000,
  });
  await expect(page.locator('.overlay')).not.toContainText(
    'Watch for cyclists beside parked cars.',
  );
});

test('local analysis POST routing uses the server handler', async ({ request }) => {
  const response = await request.post('/api/vision-advice', {
    headers: { Origin: 'https://untrusted.example' },
    data: {},
  });
  expect(response.status()).toBe(403);
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('live Claude analyzes a small batch from the actual recording', async ({ page, request }) => {
  test.skip(
    process.env.LIVE_VLM_CHECK !== '1',
    'Opt-in live request; sends sampled frames to Anthropic.',
  );
  await page.goto('/?mock=map,vision,voice');
  const frames = await page.evaluate(async () => {
    const video = document.createElement('video');
    video.muted = true;
    video.src = '/demo-drive/video.mp4';
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Video unavailable'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    const frames: Array<{ tripMs: number; jpeg: string }> = [];
    for (const seconds of [1, 2, 3]) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = seconds;
      });
      context.drawImage(video, 0, 0, 960, 540);
      frames.push({
        tripMs: seconds * 1000,
        jpeg: canvas.toDataURL('image/jpeg', 0.65).split(',')[1]!,
      });
    }
    video.removeAttribute('src');
    video.load();
    return frames;
  });
  const started = performance.now();
  const response = await request.post('/api/vision-advice', { data: { frames, recentAdvice: [] } });
  const body: unknown = await response.json();
  console.log(
    'Live Claude check:',
    JSON.stringify({
      status: response.status(),
      latencyMs: Math.round(performance.now() - started),
      result: body,
    }),
  );
  expect(response.status()).toBe(200);
  expect(body).toHaveProperty('shouldSpeak');
});
