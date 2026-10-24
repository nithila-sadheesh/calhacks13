import { CLIP_TEXT, SAMPLE_RATE, type ClipKey } from './config.ts';

export async function loadClips(signal: AbortSignal): Promise<Map<ClipKey, Float32Array>> {
  const clips = new Map<ClipKey, Float32Array>();
  const response = await fetch('/audio/manifest.json', { signal });
  if (!response.ok) return clips;
  const manifest: unknown = await response.json();
  if (!manifest || typeof manifest !== 'object') return clips;
  await Promise.all(
    (Object.keys(CLIP_TEXT) as ClipKey[]).map(async (key) => {
      const entry = (manifest as Record<string, unknown>)[key];
      if (!entry || typeof entry !== 'object') return;
      const item = entry as Record<string, unknown>;
      if (
        item.text !== CLIP_TEXT[key] ||
        item.sampleRate !== SAMPLE_RATE ||
        typeof item.file !== 'string' ||
        !/^[a-zA-Z0-9_-]+\.pcm$/.test(item.file)
      )
        return;
      try {
        const audio = await fetch(`/audio/${item.file}`, { signal });
        if (!audio.ok) return;
        const bytes = await audio.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength % 2) return;
        const view = new DataView(bytes);
        clips.set(
          key,
          Float32Array.from(
            { length: bytes.byteLength / 2 },
            (_, i) => view.getInt16(i * 2, true) / 32768,
          ),
        );
      } catch {
        /* An unavailable clip remains unavailable; never invent warning audio. */
      }
    }),
  );
  return clips;
}
