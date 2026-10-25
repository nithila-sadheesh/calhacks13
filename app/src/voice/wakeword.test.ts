// The wake word on real recorded speech (tests/fixtures/wake: macOS voices, 16 kHz), with
// background noise added so it is not judged on unnaturally clean audio. Enrolled from three takes
// of "Voya"; the app's own reminders and sound-alikes must never wake it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createWakeDetector,
  enroll,
  featuresOf,
  isWakeModel,
  MAX_THRESHOLD,
  MIN_THRESHOLD,
  trimToWord,
} from './wakeword.ts';

const DIR = 'tests/fixtures/wake';

function wav(name: string, noise: number, seed = 7): Float32Array {
  const data = readFileSync(`${DIR}/${name}.wav`).subarray(44);
  let state = seed;
  let rumble = 0;
  const rand = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647 - 0.5;
  };
  // Half a second of noise first, like a microphone that was already open.
  const lead = 8000;
  return Float32Array.from({ length: data.length / 2 + lead }, (_, i) => {
    rumble = 0.98 * rumble + 0.02 * rand();
    const speech = i >= lead ? data.readInt16LE((i - lead) * 2) / 32768 : 0;
    return speech + noise * (rumble * 8 + rand() * 0.3);
  });
}

const ENROLL = ['enroll-1', 'enroll-2', 'enroll-3'];
const WAKES = ['pos-voya-alone', 'pos-voya-whats-coming-up'];
const NEVER = [
  'neg-app-left-turn',
  'neg-app-stop-sign',
  'neg-foyer',
  'neg-oh-yeah-boy',
  'neg-toyota-loyal',
  'neg-voyage',
  'neg-whats-coming-up',
  'neg-other-voice',
];

function wakesIn(model: ReturnType<typeof enroll>, audio: Float32Array): number {
  let t = 0;
  let wakes = 0;
  const detector = createWakeDetector({ model, onWake: () => wakes++, now: () => t });
  const tail = new Float32Array(16000);
  for (const chunk of [audio, tail])
    for (let i = 0; i < chunk.length; i += 320) {
      detector.feed(chunk.subarray(i, i + 320)); // 20 ms chunks, like the microphone
      t += 20;
    }
  return wakes;
}

describe.each([
  ['quiet', 0.002],
  ['road noise', 0.03],
])('wake word in %s', (_, noise) => {
  // Each take gets its own noise, as real takes do; identical noise makes them look too alike.
  const model = enroll(ENROLL.map((n, i) => wav(n, noise, 100 + i * 37)));

  it.each(WAKES)('wakes once for %s', (name) => {
    expect(wakesIn(model, wav(name, noise, 11))).toBe(1);
  });

  it.each(NEVER)('never wakes for %s', (name) => {
    expect(wakesIn(model, wav(name, noise, 11))).toBe(0);
  });
});

describe('enrollment', () => {
  it('trims each take to the spoken word', () => {
    const word = trimToWord(featuresOf(wav('enroll-2', 0.002)))!;
    // "Voya" is well under a second; the take around it is about 1.5 s.
    expect(word.length).toBeGreaterThan(30);
    expect(word.length).toBeLessThan(110);
  });

  it('asks to try again when a take has no clear word', () => {
    const silent = new Float32Array(24000);
    expect(() => enroll([wav('enroll-1', 0.002), silent, wav('enroll-3', 0.002, 9)])).toThrow(
      /Recording 2 didn't catch a clear “Voya”/,
    );
  });

  it('three identical takes still wake on a differently paced "Voya"', () => {
    const same = enroll([1, 2, 3].map(() => wav('enroll-2', 0.002)));
    expect(same.threshold).toBe(MIN_THRESHOLD);
    expect(wakesIn(same, wav('pos-voya-whats-coming-up', 0.002, 11))).toBe(1);
    expect(wakesIn(same, wav('neg-foyer', 0.002, 11))).toBe(0);
  });

  it('keeps the threshold within the measured safe range', () => {
    const model = enroll(ENROLL.map((n, i) => wav(n, 0.03, 100 + i * 37)));
    expect(model.threshold).toBeGreaterThanOrEqual(MIN_THRESHOLD);
    expect(model.threshold).toBeLessThanOrEqual(MAX_THRESHOLD);
  });

  it('asks to try again when a take is not the same word, and says which', () => {
    expect(() =>
      enroll([wav('enroll-1', 0.002), wav('enroll-2', 0.002, 9), wav('neg-foyer', 0.002, 5)]),
    ).toThrow(/Recording 3 doesn't sound like the others/);
    expect(() =>
      enroll([
        wav('enroll-1', 0.002),
        wav('neg-whats-coming-up', 0.002, 9),
        wav('neg-foyer', 0.002, 5),
      ]),
    ).toThrow(/doesn't sound like the others/);
  });

  it('produces a model that survives storage and is recognized as valid', () => {
    const model = enroll(ENROLL.map((n, i) => wav(n, 0.002, 100 + i * 37)));
    expect(isWakeModel(JSON.parse(JSON.stringify(model)))).toBe(true);
    expect(isWakeModel({ templates: [], threshold: 1 })).toBe(false);
    expect(isWakeModel({ templates: [[[1, 2]]], threshold: 1 })).toBe(false);
    expect(isWakeModel(null)).toBe(false);
  });
});
