// Read-only deployment readiness check. Never prints key values or token contents.
import { readFile, readdir, stat } from 'node:fs/promises';
import { CLIP_TEXT, SAMPLE_RATE } from '../../app/src/voice/config.ts';
let failures = 0;
function check(ok: boolean, message: string) {
  console.log(`${ok ? 'PASS' : 'PENDING'}: ${message}`);
  if (!ok) failures++;
}
const manifest: unknown = JSON.parse(await readFile('fixtures/audio/manifest.json', 'utf8'));
for (const [key, text] of Object.entries(CLIP_TEXT)) {
  const entry =
    manifest && typeof manifest === 'object'
      ? (manifest as Record<string, unknown>)[key]
      : undefined;
  if (!entry || typeof entry !== 'object') {
    check(false, `Bundled clip ${key}`);
    continue;
  }
  const item = entry as Record<string, unknown>;
  const file =
    typeof item.file === 'string' && /^[a-zA-Z0-9_-]+\.pcm$/.test(item.file)
      ? item.file
      : undefined;
  const info = file ? await stat(`fixtures/audio/${file}`).catch(() => null) : null;
  check(
    Boolean(
      info?.size && info.size % 2 === 0 && item.text === text && item.sampleRate === SAMPLE_RATE,
    ),
    `Bundled clip ${key}`,
  );
}
const assets = await readdir('dist/assets').catch(() => []);
check(
  assets.some((name) => name.startsWith('captureWorklet-') && name.endsWith('.js')),
  'AudioWorklet is included in the production build',
);
for (const name of ['CARTESIA_API_KEY', 'ANTHROPIC_API_KEY']) {
  const key = process.env[name];
  if (key) {
    let exposed = false;
    for (const asset of assets) {
      if ((await readFile(`dist/assets/${asset}`, 'utf8')).includes(key)) exposed = true;
    }
    check(!exposed, `${name} is absent from client assets`);
  } else check(false, `Load ${name} server-side to verify absence from client assets`);
}
const config: unknown = JSON.parse(await readFile('vercel.json', 'utf8'));
check(
  Boolean(config && typeof config === 'object' && 'functions' in config),
  'Vercel function configuration exists',
);
console.log(
  'Vercel account connection, server environment variable and live HTTPS checks must be verified separately.',
);
process.exitCode = failures ? 1 : 0;
