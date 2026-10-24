import { afterEach, expect, it, vi } from 'vitest';
import { loadClips } from './clips.ts';
import { CLIP_TEXT, SAMPLE_RATE } from './config.ts';

afterEach(() => vi.unstubAllGlobals());
it('preloads local PCM clips and ignores external URLs and wrong wording', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        pedestrianNearby: {
          file: 'person.pcm',
          text: CLIP_TEXT.pedestrianNearby,
          sampleRate: SAMPLE_RATE,
        },
        followingDistance: {
          file: 'https://other.example/audio.pcm',
          text: CLIP_TEXT.followingDistance,
          sampleRate: SAMPLE_RATE,
        },
        turn: { file: 'turn.pcm', text: 'Go now', sampleRate: SAMPLE_RATE },
      }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array([0, 128, 255, 127])));
  vi.stubGlobal('fetch', fetcher);
  const clips = await loadClips(new AbortController().signal);
  expect(clips.size).toBe(1);
  expect([...clips.get('pedestrianNearby')!]).toEqual([-1, 32767 / 32768]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[0]).toBe('/audio/person.pcm');
});
it('does not accept truncated PCM files', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          turn: { file: 'turn.pcm', text: CLIP_TEXT.turn, sampleRate: SAMPLE_RATE },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([0]))),
  );
  expect((await loadClips(new AbortController().signal)).size).toBe(0);
});
