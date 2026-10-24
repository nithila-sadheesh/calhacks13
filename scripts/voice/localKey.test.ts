import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadLocalKey } from './localKey.ts';
const directories: string[] = [];
async function path() {
  const directory = await mkdtemp(join(tmpdir(), 'voice-key-'));
  directories.push(directory);
  return join(directory, '.env');
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
it('prefers the edited .env over a stale inherited key and handles quoted values', async () => {
  const file = await path();
  await writeFile(file, 'CARTESIA_API_KEY="test-new-value"\n');
  expect(await loadLocalKey(file, { CARTESIA_API_KEY: 'test-old-value' })).toBe('test-new-value');
});
it('accepts an environment-only key when no .env exists', async () => {
  expect(await loadLocalKey(await path(), { CARTESIA_API_KEY: 'test-environment-value' })).toBe(
    'test-environment-value',
  );
});
it('does not silently fall back when the local key is empty', async () => {
  const file = await path();
  await writeFile(file, 'CARTESIA_API_KEY=\n');
  await expect(loadLocalKey(file, { CARTESIA_API_KEY: 'test-old-value' })).rejects.toThrow(
    'Set CARTESIA_API_KEY',
  );
});
