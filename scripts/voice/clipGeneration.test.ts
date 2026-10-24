import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { generateClipSet } from './clipGeneration.ts';
import { CLIP_TEXT } from '../../app/src/voice/config.ts';
const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'voice-clips-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it('writes six real-response PCM assets and a complete manifest using one voice', async () => {
  const dir = await directory();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(new Uint8Array([0, 0, 1, 0])));
  const manifest = await generateClipSet({ key: 'test-key', directory: dir, fetcher });
  expect(Object.keys(manifest)).toEqual(Object.keys(CLIP_TEXT));
  expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual(manifest);
  for (const [key, entry] of Object.entries(manifest)) {
    expect(await readFile(join(dir, entry.file))).toHaveLength(4);
    expect(entry.text).toBe(CLIP_TEXT[key as keyof typeof CLIP_TEXT]);
  }
  expect(fetcher).toHaveBeenCalledTimes(6);
  const voices = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).voice);
  expect(new Set(voices).size).toBe(1);
});
it('preserves the old manifest on partial failure and never writes error bodies as audio', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'manifest.json'), '{"existing":true}');
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(new Uint8Array([0, 0])))
    .mockResolvedValueOnce(Response.json({ error: 'secret' }, { status: 401 }));
  await expect(generateClipSet({ key: 'test-key', directory: dir, fetcher })).rejects.toThrow(
    'HTTP 401',
  );
  expect(await readFile(join(dir, 'manifest.json'), 'utf8')).toBe('{"existing":true}');
});
