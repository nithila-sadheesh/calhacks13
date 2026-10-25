// Live mode end to end in Chrome, with a fake camera (Chrome's test pattern) and a fixed GPS fix
// on the demo route. Checks the start/end flow, the arbiter and captions on live trip time, and
// that the real map and vision modules run on the camera stream with a clean console.
import { expect, test, type Page } from '@playwright/test';

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 37.8716, longitude: -122.2725, accuracy: 5 },
});

const video = (page: Page) => page.locator('video');

async function startLive(page: Page, mocks: string) {
  const problems: string[] = [];
  const logs: string[] = [];
  page.on('console', (m) => {
    logs.push(m.text());
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(mocks ? `/?mock=${mocks},assistant` : '/');
  await page.getByRole('checkbox', { name: 'A licensed adult is in the passenger seat.' }).check();
  await page.getByRole('button', { name: 'Start live drive' }).click();
  await page.getByRole('button', { name: 'Start drive' }).click({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'End drive' })).toBeVisible();
  return { problems, logs };
}

test('live: camera starts, route and vision coaching play, end stops the camera', async ({
  page,
}) => {
  const { problems } = await startLive(page, 'map,vision,voice');
  await expect(video(page)).toHaveJSProperty('paused', false);
  await expect(page.locator('.overlay, .status-strip')).toHaveCount(0);
  expect(await video(page).evaluate((v: HTMLVideoElement) => v.srcObject !== null)).toBe(true);
  expect(await video(page).evaluate((v: HTMLVideoElement) => v.controls)).toBe(false);

  await page.locator('.timeline-collapse > summary').click();
  const captions = page.locator('.captions p');
  await expect(captions).toHaveText('Stop sign ahead. Prepare for a complete stop.', {
    timeout: 6000,
  });
  await expect(captions).toHaveText('Scan curb edges for pedestrians.', { timeout: 7000 });
  await expect(page.locator('.timeline-row', { hasText: 'Video coaching' })).toBeVisible();

  await page.getByRole('button', { name: 'End drive' }).click();
  await expect(page.getByRole('button', { name: 'Start drive' })).toBeVisible();
  expect(await video(page).evaluate((v: HTMLVideoElement) => v.srcObject)).toBeNull();
  expect(problems).toEqual([]);
});

test('live: a second drive starts from a clean slate', async ({ page }) => {
  await startLive(page, 'map,vision,voice');
  await page.locator('.timeline-collapse > summary').click();
  const timeline = page.locator('.timeline-row');
  await expect(timeline.first()).toBeVisible({ timeout: 6000 });
  await page.getByRole('button', { name: 'End drive' }).click();
  await page.getByRole('button', { name: 'Start drive' }).click();
  await expect(timeline).toHaveCount(0);
  await expect(page.locator('.timeline-row', { hasText: 'Stop sign' })).toBeVisible({
    timeout: 6000,
  });
});

test('live: real map and vision run on device GPS and the camera stream', async ({ page }) => {
  const { problems, logs } = await startLive(page, 'voice,assistant');
  await expect.poll(() => logs.some((l) => l.includes('detector loaded'))).toBe(true);
  await expect.poll(() => logs.some((l) => l.includes('route match: ok'))).toBe(true);
  // Inference keeps up on the live stream: no stall reported over a few seconds.
  await page.waitForTimeout(4000);
  expect(logs.filter((l) => l.includes('camera health down'))).toEqual([]);
  // The video container follows the camera aspect ratio.
  const shape = await video(page).evaluate((v: HTMLVideoElement) => {
    const box = v.parentElement!.getBoundingClientRect();
    return { video: v.videoWidth / v.videoHeight, box: box.width / box.height };
  });
  expect(shape.box).toBeCloseTo(shape.video, 1);
  expect(problems).toEqual([]);
});
