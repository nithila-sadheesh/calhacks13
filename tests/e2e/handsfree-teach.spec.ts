// Teaching "Voya" and waking on it, in Chrome. The fake microphone loops a recorded "Voya" every
// 2.4 s, the rhythm of the three takes, so each take catches one; afterwards the same loop must
// wake hands-free.
import { expect, test } from '@playwright/test';
import { HANDS_FREE_ON, micFrom, startDrive } from './handsfreeSetup.ts';

test.use(micFrom('mic-voya-loop.wav'));

test('learns "Voya" from three takes, then wakes on it', async ({ page }) => {
  const logs: string[] = [];
  await startDrive(page, logs);
  await expect(page.getByText(/Teach hands-free your voice/)).toBeVisible();
  await page.getByRole('button', { name: 'Teach “Voya”' }).click();
  await expect(page.getByText(/after the chime \(1 of 3\)/)).toBeVisible();
  await expect(page.getByText(HANDS_FREE_ON)).toBeVisible({ timeout: 15_000 });
  const stored = await page.evaluate(() => localStorage.getItem('learner-copilot.voyaModel'));
  expect(JSON.parse(stored!).templates).toHaveLength(3);
  await expect
    .poll(() => logs.some((l) => l.includes('wake word heard')), { timeout: 10_000 })
    .toBe(true);
  // A hands-free request opened: the microphone is recording.
  await expect(page.locator('.mic-button[aria-pressed="true"]')).toBeVisible();
});
