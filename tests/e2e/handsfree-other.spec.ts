// Hands-free must never wake on other speech: the fake microphone loops the app's own reminders and
// sound-alikes ("what's coming up", "foyer", "voyage") to a model learned from recorded "Voya" takes.
import { expect, test } from '@playwright/test';
import { enroll } from '../../app/src/voice/wakeword.ts';
import { HANDS_FREE_ON, micFrom, startDrive, wav16k } from './handsfreeSetup.ts';

test.use(micFrom('mic-other-speech.wav'));

test("never wakes on the app's own reminders or sound-alikes", async ({ page }) => {
  const model = enroll(['enroll-1', 'enroll-2', 'enroll-3'].map(wav16k));
  await page.addInitScript(
    (m) => localStorage.setItem('learner-copilot.voyaModel', m),
    JSON.stringify(model),
  );
  const logs: string[] = [];
  await startDrive(page, logs);
  await expect(page.getByText(HANDS_FREE_ON)).toBeVisible();
  // The clip is 9.5 s and loops: about two passes of every sentence.
  await page.waitForTimeout(20_000);
  expect(logs.filter((l) => l.includes('wake word heard'))).toEqual([]);
});
