// iPhone browsers all run WebKit, which rejects microphone capture under the 'playback' audio
// session that keeps speech audible with the silent switch on. These run in Playwright's WebKit:
// tapping the mic must start listening (not fail) and switch the session for the capture, with
// hands-free off and before the wake word is taught.
import { expect, test, type Page } from '@playwright/test';

test.use({
  permissions: ['camera', 'microphone', 'geolocation'],
  geolocation: { latitude: 37.8716, longitude: -122.2725, accuracy: 5 },
});

const sessionType = (page: Page) =>
  page.evaluate(() => (navigator as { audioSession?: { type: string } }).audioSession?.type);

async function startDrive(page: Page) {
  // Keep Ink from connecting: these tests are about local capture, and need no Cartesia key.
  await page.route('**/api/cartesia-token', () => {});
  await page.goto('/?mock=map,vision,assistant');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start live drive' }).click();
  await page.getByRole('button', { name: 'Start drive' }).click({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'End drive' })).toBeVisible();
}

async function tapAndListen(page: Page) {
  await page.getByRole('button', { name: 'Talk' }).click();
  const status = page.locator('.mic p[role=status]');
  await expect(status).toHaveText('Listening… pause or tap again when you’re done.');
  await page.waitForTimeout(1500);
  await expect(status).toHaveText('Listening… pause or tap again when you’re done.');
  expect(await sessionType(page)).toBe('play-and-record');
}

test('with hands-free off, the microphone opens on WebKit while playback is unlocked', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('learner-copilot.handsFree', 'off'));
  await startDrive(page);
  await expect(page.getByText('Hands-free is off.')).toBeVisible();
  expect(await sessionType(page)).toBe('playback');
  await tapAndListen(page);
});

test('before "Voya" is taught, it offers to teach it and tapping still works', async ({ page }) => {
  await startDrive(page);
  await expect(page.getByRole('button', { name: 'Teach “Voya”' })).toBeVisible();
  // Nothing is listening yet, so speech plays in the playback session.
  expect(await sessionType(page)).toBe('playback');
  await tapAndListen(page);
});
