// The app shell end to end in Chrome: setup screen, then a replay with the real arbiter and the
// map, vision and voice mocks (cue at 3 s, alert at 5 s). Checks captions, timeline, data use,
// seek reset, pause, the 1x lock, and that the console stays clean.
import { expect, test, type Page } from '@playwright/test';

const video = (page: Page) => page.locator('video');

async function startDrive(page: Page, mocks = 'map,vision,voice') {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`/?mock=${mocks},assistant`);
  await page.getByRole('checkbox', { name: 'A licensed adult is in the passenger seat.' }).check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await expect(video(page)).toHaveJSProperty('readyState', 4);
  return problems;
}

const play = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.play());
const seek = (page: Page, s: number) =>
  video(page).evaluate((v: HTMLVideoElement, t) => (v.currentTime = t), s);
const tripSeconds = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentTime);

async function fakeSonicSocket(page: Page) {
  await page.addInitScript(() => {
    class FakeSocket {
      static OPEN = 1;
      readyState = 0;
      onopen?: () => void;
      onclose?: () => void;
      constructor() {
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();
        }, 0);
      }
      send() {}
      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }
    window.WebSocket = FakeSocket as unknown as typeof WebSocket;
  });
}

test('setup screen requires the supervisor check', async ({ page }) => {
  await page.goto('/');
  const start = page.getByRole('button', { name: 'Load demo drive' });
  await expect(start).toBeDisabled();
  await expect(page.getByText('Video frames stay on the device.')).toBeVisible();
  await page.getByRole('checkbox').check();
  await expect(start).toBeEnabled();
});

test('replay: map cue, queued video coaching, timeline, data use, seek reset', async ({ page }) => {
  const problems = await startDrive(page);
  const captions = page.locator('.captions p');
  await page.locator('.timeline-collapse > summary').click();
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const dataUse = page.getByRole('region', { name: 'Data use' });

  await play(page);
  await expect(captions).toHaveText('Stop sign ahead. Prepare for a complete stop.', {
    timeout: 6000,
  });
  await expect(captions).toHaveText('Scan curb edges for pedestrians.', { timeout: 7000 });

  const stopRow = timeline.locator('.timeline-row', { hasText: 'Stop sign' });
  await expect(stopRow).toContainText('mock: stop sign 74 m ahead at 9 m/s');
  await expect(stopRow.locator('.step-spoken')).toContainText('first audible 250 ms');
  await expect(timeline.locator('.timeline-row', { hasText: 'Video coaching' })).toBeVisible();
  await expect(dataUse.locator('li')).toHaveCount(2);
  await expect(page.locator('.captions')).toHaveText('Spoken lines appear here.', {
    timeout: 4000,
  });

  await seek(page, 1);
  await play(page);
  await expect(timeline.locator('.timeline-row')).toHaveCount(0);
  await expect(dataUse.locator('li')).toHaveCount(0);
  await expect(timeline.locator('.timeline-row', { hasText: 'Stop sign' })).toBeVisible({
    timeout: 6000,
  });
  await expect(timeline.locator('.timeline-row', { hasText: 'Video coaching' })).toBeVisible({
    timeout: 7000,
  });

  expect(problems).toEqual([]);
});

test('pausing freezes trip time and nothing new is spoken', async ({ page }) => {
  await startDrive(page);
  await play(page);
  await expect.poll(() => tripSeconds(page)).toBeGreaterThan(0.5);
  await video(page).evaluate((v: HTMLVideoElement) => v.pause());
  const at = await tripSeconds(page);
  await page.waitForTimeout(3500);
  expect(await tripSeconds(page)).toBe(at);
  await expect(page.locator('.timeline-row')).toHaveCount(0);
});

test('playback stays at 1x', async ({ page }) => {
  await startDrive(page);
  await video(page).evaluate((v: HTMLVideoElement) => (v.playbackRate = 2));
  await expect(video(page)).toHaveJSProperty('playbackRate', 1);
});

test('all mocks: modules start, then the idle state is announced', async ({ page }) => {
  // The vision mock emits cameraHealth inside start(); tripState idle must follow it, once every
  // module has started.
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  const problems = await startDrive(page, 'map,vision,voice,arbiter');
  const order = logs.filter((l) => l.includes('cameraHealth') || l.includes('tripState'));
  expect(order[0]).toContain('cameraHealth');
  expect(order[1]).toContain('idle');
  expect(problems).toEqual([]);
});

test('local token route reaches the production handler and rejects cross-origin requests', async ({
  request,
}) => {
  const response = await request.get('/api/cartesia-token', {
    headers: { Origin: 'https://untrusted.example' },
  });
  expect(response.status()).toBe(403);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ error: 'Cross-origin token requests are not allowed.' });
});

test('real voice loads clips and unlocks sound before replay controls are offered', async ({
  page,
}) => {
  await page.route('**/api/cartesia-token', (route) =>
    route.fulfill({ json: { token: 'test-token' } }),
  );
  await fakeSonicSocket(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/audio/manifest.json', async (route) => {
    await gate;
    await route.fulfill({ json: {} });
  });
  await page.goto('/?mock=map,vision,assistant');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await expect(
    page.getByRole('status', { name: '' }).filter({ hasText: 'Loading drive modules' }),
  ).toBeVisible();
  await expect(video(page)).toHaveJSProperty('controls', false);
  release();
  await page.getByRole('button', { name: 'Enable replay sound' }).click();
  await expect(video(page)).toHaveJSProperty('controls', true);
});

test('sound unlock remains available after a temporary token warmup failure', async ({ page }) => {
  await fakeSonicSocket(page);
  let attempts = 0;
  await page.route('**/api/cartesia-token', (route) => {
    attempts++;
    return route.fulfill(
      attempts === 1
        ? { status: 503, json: { error: 'not configured' } }
        : { json: { token: 'test-token' } },
    );
  });
  await page.goto('/?mock=map,vision,assistant');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Load demo drive' }).click();
  await page.getByRole('button', { name: 'Enable replay sound' }).click();
  await expect(page.locator('video')).toHaveJSProperty('controls', true);
});
