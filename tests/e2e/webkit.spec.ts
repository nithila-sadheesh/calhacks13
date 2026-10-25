// iPhone browsers all run WebKit, which rejects microphone capture under the 'playback' audio
// session that keeps speech audible with the silent switch on. This runs in Playwright's WebKit:
// tapping the mic must start listening (not fail) and switch the session for the capture.
import { expect, test } from '@playwright/test';

test.use({
  permissions: ['camera', 'microphone', 'geolocation'],
  geolocation: { latitude: 37.8716, longitude: -122.2725, accuracy: 5 },
});

test('the microphone opens on WebKit while speech playback is unlocked', async ({ page }) => {
  // Keep Ink from connecting: this test is about local capture, and needs no Cartesia key.
  await page.route('**/api/cartesia-token', () => {});
  await page.goto('/?mock=map,vision,assistant');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start live drive' }).click();
  await page.getByRole('button', { name: 'Start drive' }).click({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'End drive' })).toBeVisible();
  const sessionType = () =>
    page.evaluate(() => (navigator as { audioSession?: { type: string } }).audioSession?.type);
  expect(await sessionType()).toBe('playback');

  await page.getByRole('button', { name: 'Talk' }).tap();
  const status = page.locator('.mic p[role=status]');
  await expect(status).toHaveText('Listening… tap again when you’re done.');
  await page.waitForTimeout(1500);
  await expect(status).toHaveText('Listening… tap again when you’re done.');
  expect(await sessionType()).toBe('play-and-record');
});
