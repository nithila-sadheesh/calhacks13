// Shared setup for the hands-free "Voya" tests: recorded speech as the microphone (Chrome's fake
// capture device loops the file) and a live drive with real voice and the other modules mocked.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

export const FIXTURES = resolve('tests/fixtures/wake');

export function wav16k(name: string): Float32Array {
  const data = readFileSync(`${FIXTURES}/${name}.wav`).subarray(44);
  return Float32Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2) / 32768);
}

export const micFrom = (file: string) => ({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--use-file-for-fake-audio-capture=${FIXTURES}/${file}`,
    ],
  },
  permissions: ['camera', 'microphone', 'geolocation'],
  geolocation: { latitude: 37.8716, longitude: -122.2725, accuracy: 5 },
});

export async function startDrive(page: Page, logs: string[]) {
  page.on('console', (m) => logs.push(m.text()));
  // Ink stays unconnected: these tests are about the on-device wake word, not transcription.
  await page.route('**/api/cartesia-token', () => {});
  await page.goto('/?mock=map,vision,assistant');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start live drive' }).click();
  await page.getByRole('button', { name: 'Start drive' }).click({ timeout: 20_000 });
}

export const HANDS_FREE_ON = 'Hands-free on: say “Voya”, then your question.';
