import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  CARTESIA_VERSION,
  CLIP_TEXT,
  SAMPLE_RATE,
  SONIC_MODEL,
  VOICE_ID,
} from '../../app/src/voice/config.ts';
export async function generateClipSet(options: {
  key: string;
  directory: string;
  fetcher?: typeof fetch;
  report?: (message: string) => void;
}) {
  const { key, directory } = options;
  const fetcher = options.fetcher ?? fetch;
  await mkdir(directory, { recursive: true });
  const manifest: Record<
    string,
    { file: string; text: string; sampleRate: number; model: string; voice: string }
  > = {};
  for (const [clipKey, text] of Object.entries(CLIP_TEXT)) {
    options.report?.(`Generating ${clipKey}: ${text}`);
    const response = await fetcher('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': key,
        'Cartesia-Version': CARTESIA_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: SONIC_MODEL,
        voice: VOICE_ID,
        transcript: text,
        language: 'en',
        generation_config: { emotion: 'calm' },
        output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message
              .split(key)
              .join('[redacted]')
              .replace(/(?:sk_car_|sk_|Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '[redacted]')
              .replace(/https?:\/\/\S+/g, '[URL omitted]')
              .slice(0, 300)
          : 'No explanation returned.';
      throw new Error(`Cartesia rejected ${clipKey} (HTTP ${response.status}). ${message}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length % 2 || bytes.length > SAMPLE_RATE * 2 * 30)
      throw new Error(`Invalid PCM response for ${clipKey}.`);
    // Content-hashed filenames preserve an existing complete manifest if a later request fails.
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const file = `${clipKey}-${digest}.pcm`;
    await writeFile(`${directory}/${file}`, bytes);
    manifest[clipKey] = {
      file,
      text,
      sampleRate: SAMPLE_RATE,
      model: SONIC_MODEL,
      voice: VOICE_ID,
    };
  }
  await writeFile(`${directory}/manifest.json.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(`${directory}/manifest.json.tmp`, `${directory}/manifest.json`);
  options.report?.('All six clips saved. Reload the app to preload them.');
  return manifest;
}
