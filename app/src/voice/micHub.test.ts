import { describe, expect, it, vi } from 'vitest';
import type { openCapture } from './capture.ts';
import { createMicHub, PREROLL_KEEP_MS } from './micHub.ts';

function setup() {
  let feed!: (samples: Float32Array) => void;
  const stop = vi.fn();
  const open = vi.fn<typeof openCapture>().mockImplementation(async (onSamples) => {
    feed = onSamples;
    return { sampleRate: 48000, stop };
  });
  const hub = createMicHub(open);
  return { hub, open, stop, feed: (s: Float32Array) => feed(s) };
}

const chunk = (value: number) => new Float32Array(960).fill(value); // 20 ms at 48 kHz

describe('shared microphone', () => {
  it('opens the microphone once and fans the stream out to every listener', async () => {
    const s = setup();
    await Promise.all([s.hub.start(), s.hub.start()]);
    expect(s.open).toHaveBeenCalledTimes(1);
    const a = vi.fn();
    const b = vi.fn();
    s.hub.subscribe(a);
    const offB = s.hub.subscribe(b);
    s.feed(chunk(0.1));
    offB();
    s.feed(chunk(0.2));
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('keeps only the last two seconds for pre-roll', async () => {
    const s = setup();
    await s.hub.start();
    for (let i = 0; i < 200; i++) s.feed(chunk(i)); // 4 s
    const kept = s.hub.recent(PREROLL_KEEP_MS * 2);
    expect(kept.length).toBe(PREROLL_KEEP_MS / 20);
    expect(kept.at(-1)![0]).toBe(199);
    expect(s.hub.recent(100).map((c) => c[0])).toEqual([195, 196, 197, 198, 199]);
  });

  it('gives a talk session the recent audio first, then the live stream, until it stops', async () => {
    const s = setup();
    await s.hub.start();
    for (let i = 0; i < 10; i++) s.feed(chunk(i));
    const got: number[] = [];
    const controller = new AbortController();
    const session = await s.hub.captureFor(60)(
      (samples) => got.push(samples[0]!),
      controller.signal,
    );
    expect(got).toEqual([7, 8, 9]);
    s.feed(chunk(10));
    session.stop();
    s.feed(chunk(11));
    expect(got).toEqual([7, 8, 9, 10]);
    expect(s.stop).not.toHaveBeenCalled();
  });

  it('opens its own microphone for a talk session when hands-free is off', async () => {
    const s = setup();
    await s.hub.captureFor(500)(() => {}, new AbortController().signal);
    expect(s.open).toHaveBeenCalledTimes(1);
    expect(s.hub.running()).toBe(false);
  });

  it('stop closes the microphone and forgets the buffered audio', async () => {
    const s = setup();
    await s.hub.start();
    s.feed(chunk(1));
    s.hub.stop();
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.hub.running()).toBe(false);
    expect(s.hub.recent(1000)).toEqual([]);
  });
});
