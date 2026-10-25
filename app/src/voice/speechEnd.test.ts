import { describe, expect, it } from 'vitest';
import {
  createSpeechTracker,
  END_OF_SPEECH_MS,
  IGNORE_FIRST_MS,
  NO_SPEECH_MS,
  rms,
} from './speechEnd.ts';

const CHUNK_MS = 20;
const chunk = (level: number) => new Float32Array(960).fill(level);

function setup() {
  let t = 0;
  const tracker = createSpeechTracker(() => t);
  const feed = (level: number, ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += CHUNK_MS) {
      tracker.push(chunk(level));
      t += CHUNK_MS;
    }
  };
  return { tracker, feed };
}

describe('end of a hands-free request', () => {
  it('measures loudness', () => {
    expect(rms(chunk(0.5))).toBeCloseTo(0.5);
    expect(rms(new Float32Array())).toBe(0);
  });

  it('gives up when nobody speaks', () => {
    const s = setup();
    s.feed(0.002, NO_SPEECH_MS - CHUNK_MS);
    expect(s.tracker.ended()).toBe(false);
    s.feed(0.002, 2 * CHUNK_MS);
    expect(s.tracker.heard()).toBe(false);
    expect(s.tracker.ended()).toBe(true);
  });

  it('ignores the chime at the start', () => {
    const s = setup();
    s.feed(0.2, IGNORE_FIRST_MS - CHUNK_MS);
    s.feed(0.002, 1000);
    expect(s.tracker.heard()).toBe(false);
  });

  it('survives a mid-sentence pause and ends after a real silence', () => {
    const s = setup();
    // Speech with the short gaps between words that real speech always has.
    const talk = (ms: number) => {
      for (let e = 0; e < ms; e += 200) {
        s.feed(0.1, 160);
        s.feed(0.003, 40);
      }
    };
    s.feed(0.002, IGNORE_FIRST_MS);
    talk(600);
    s.feed(0.002, 900);
    expect(s.tracker.ended()).toBe(false);
    talk(2600);
    expect(s.tracker.ended()).toBe(false);
    // talk() ends on a 40 ms gap, which already counts toward the silence.
    s.feed(0.002, END_OF_SPEECH_MS - 6 * CHUNK_MS);
    expect(s.tracker.ended()).toBe(false);
    s.feed(0.002, 4 * CHUNK_MS);
    expect(s.tracker.ended()).toBe(true);
  });

  it('treats a sound that never changes for seconds (an engine drone) as background', () => {
    const s = setup();
    s.feed(0.002, IGNORE_FIRST_MS);
    s.feed(0.08, 6000);
    expect(s.tracker.ended()).toBe(true);
  });

  it('hears a speaker who is already talking when recording starts', () => {
    const s = setup();
    // Speech with the short gaps between words that real speech always has.
    for (let i = 0; i < 20; i++) {
      s.feed(0.12, 160);
      s.feed(0.003, 40);
    }
    expect(s.tracker.heard()).toBe(true);
    expect(s.tracker.ended()).toBe(false);
  });

  it('adapts to steady road noise, and still hears speech over it', () => {
    const s = setup();
    s.feed(0.02, 3000);
    expect(s.tracker.heard()).toBe(false);
    s.feed(0.15, 400);
    expect(s.tracker.heard()).toBe(true);
  });
});
