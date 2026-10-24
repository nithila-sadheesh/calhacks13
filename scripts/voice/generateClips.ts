// Run from repo root with `npm run clips` (loads the git-ignored .env).
import { fileURLToPath } from 'node:url';
import { generateClipSet } from './clipGeneration.ts';
import { loadLocalKey } from './localKey.ts';
const key = await loadLocalKey();
try {
  await generateClipSet({
    key,
    directory: fileURLToPath(new URL('../../fixtures/audio/', import.meta.url)),
    report: (message) => console.log(message),
  });
} catch (error: unknown) {
  const message =
    error instanceof Error && /^Cartesia rejected |^Invalid PCM response /.test(error.message)
      ? error.message
      : 'Clip generation could not reach Cartesia or write the files. Existing manifest was preserved.';
  console.error(message);
  process.exitCode = 1;
}
