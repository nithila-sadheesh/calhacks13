// The "Voya" wake word, learned from the user's own recordings and matched on the device: no
// account, no network. Enrollment turns three recordings into templates (feature sequences of the
// spoken word). Listening runs the same features on the live microphone and, ten times a second,
// compares the last moment of audio with each template by dynamic time warping, which tolerates
// the word being said faster or slower. It wakes when the closest match is within a threshold
// calibrated from how alike the three recordings are.
import { CEPSTRA, createFeatureStream, type FeatureFrame } from './features.ts';

export const WAKE_WORD = 'Voya';
export const ENROLL_TAKES = 3;
const CHECK_EVERY_FRAMES = 10; // 100 ms
// The match must end within this many frames of now: the word was just said.
const RECENT_END_FRAMES = 15;
const COOLDOWN_MS = 2000;
// Threshold = this times the mean distance between the user's own recordings, kept within
// [MIN_THRESHOLD, MAX_THRESHOLD]. Measured on recorded speech in quiet, car-like and white noise
// (takes with their own noise each, as real ones have): "Voya" scored at most 1.13x the spread and
// 7.9 in absolute terms; no other phrase (the app's own reminders, the sound-alikes "voyage",
// "foyer", "Toyota", "loyal") scored under 1.69x or 11.35. The floor keeps three very consistent
// takes from making it too strict to wake again; the ceiling keeps loose takes from waking on
// other words. "Hey Voya" scores higher than "Voya" alone, so the app asks for "Voya".
export const THRESHOLD_FACTOR = 1.4;
export const MIN_THRESHOLD = 9;
export const MAX_THRESHOLD = 10.5;
const MAX_TAKE_SPREAD = 9;
// Frames this far below the loudest frame of a recording are silence around the word.
const TRIM_DB = 25;
const WORD_OVER_NOISE_DB = 6;
const MIN_WORD_FRAMES = 15; // 150 ms
const MAX_WORD_FRAMES = 150; // 1.5 s

export type WakeModel = { templates: number[][][]; threshold: number };

const distance = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
};

// How closely `template` matches some stretch of `stream` ending at one of its last `endWithin`
// frames: open-begin, open-end DTW with the standard symmetric steps (a diagonal step counts its
// distance twice), normalized by the combined length of the template and the matched stretch.
// Lower is closer; stretching a match through unrelated frames always adds cost.
export function matchCost(
  template: ArrayLike<ArrayLike<number>>,
  stream: ArrayLike<ArrayLike<number>>,
  endWithin = stream.length,
): number {
  const m = template.length;
  const n = stream.length;
  if (m === 0 || n === 0) return Infinity;
  let cost = new Float64Array(n);
  let start = new Int32Array(n);
  for (let j = 0; j < n; j++) {
    cost[j] = distance(template[0]!, stream[j]!);
    start[j] = j;
  }
  for (let i = 1; i < m; i++) {
    const nextCost = new Float64Array(n);
    const nextStart = new Int32Array(n);
    for (let j = 0; j < n; j++) {
      const d = distance(template[i]!, stream[j]!);
      let best = cost[j]! + d; // template advances, stream stays
      let from = start[j]!;
      if (j > 0) {
        const diag = cost[j - 1]! + 2 * d;
        if (diag < best) {
          best = diag;
          from = start[j - 1]!;
        }
        const left = nextCost[j - 1]! + d; // stream advances, template stays
        if (left < best) {
          best = left;
          from = nextStart[j - 1]!;
        }
      }
      nextCost[j] = best;
      nextStart[j] = from;
    }
    cost = nextCost;
    start = nextStart;
  }
  let best = Infinity;
  for (let j = Math.max(0, n - endWithin); j < n; j++)
    best = Math.min(best, cost[j]! / (m + (j - start[j]! + 1)));
  return best;
}

export function featuresOf(samples16k: Float32Array): FeatureFrame[] {
  return createFeatureStream().push(samples16k);
}

// The spoken word inside a recording: from the first to the last frame clearly above the
// background (TRIM_DB below the loudest frame, and at least WORD_OVER_NOISE_DB above the noise
// floor, its 10th-percentile energy). Undefined when there is no clear word.
export function trimToWord(frames: FeatureFrame[]): FeatureFrame[] | undefined {
  if (frames.length === 0) return undefined;
  const sorted = frames.map((f) => f.energy).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)]!;
  const loudest = sorted.at(-1)!;
  const cut = Math.max(loudest - TRIM_DB, floor + WORD_OVER_NOISE_DB);
  const voiced = frames.map((f) => f.energy > cut);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return undefined;
  const word = frames.slice(first, last + 1);
  if (word.length < MIN_WORD_FRAMES || word.length > MAX_WORD_FRAMES) return undefined;
  return word;
}

// Builds the wake model from the enrollment recordings (16 kHz). Throws with a message the user
// can act on when a recording has no clear word in it.
export function enroll(recordings: Float32Array[]): WakeModel {
  const full = recordings.map(featuresOf);
  const words = full.map(trimToWord);
  words.forEach((w, i) => {
    if (!w) throw new Error(`Recording ${i + 1} didn't catch a clear “${WAKE_WORD}”. Try again.`);
  });
  const templates = (words as FeatureFrame[][]).map((w) => w.map((f) => Array.from(f.mfcc)));
  // How far each take is from the other recordings, on average.
  const perTake = templates.map((t, i) => {
    const others = full
      .filter((_, j) => j !== i)
      .map((o) =>
        matchCost(
          t,
          o.map((f) => f.mfcc),
        ),
      );
    return others.reduce((a, b) => a + b, 0) / others.length;
  });
  // A take this unlike the others is not the same word (a cough, another word): real "Voya" takes
  // were 6.6 to 7.0 apart in every condition measured.
  // One unlike take also lifts the others' averages, so the culprit is the furthest one.
  const odd = perTake.indexOf(Math.max(...perTake));
  if (perTake[odd]! > MAX_TAKE_SPREAD)
    throw new Error(
      `Recording ${odd + 1} doesn't sound like the others. Try again, saying “${WAKE_WORD}” the same way each time.`,
    );
  const mean = perTake.reduce((a, b) => a + b, 0) / perTake.length;
  const threshold = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, mean * THRESHOLD_FACTOR));
  return { templates, threshold };
}

export function isWakeModel(v: unknown): v is WakeModel {
  if (!v || typeof v !== 'object') return false;
  const { templates, threshold } = v as Partial<WakeModel>;
  return (
    typeof threshold === 'number' &&
    Number.isFinite(threshold) &&
    Array.isArray(templates) &&
    templates.length > 0 &&
    templates.every(
      (t) =>
        Array.isArray(t) &&
        t.length > 0 &&
        t.every((f) => Array.isArray(f) && f.length === CEPSTRA),
    )
  );
}

export type WakeDetector = { feed(samples16k: Float32Array): void };

// Live matching. `feed` takes 16 kHz audio in any chunk size.
export function createWakeDetector(options: {
  model: WakeModel;
  onWake: () => void;
  now?: () => number;
}): WakeDetector {
  const now = options.now ?? (() => performance.now());
  const longest = Math.max(...options.model.templates.map((t) => t.length));
  const { templates } = options.model;
  const keep = Math.ceil(longest * 1.6) + RECENT_END_FRAMES;
  const stream = createFeatureStream();
  const recent: Float32Array[] = [];
  const energies: number[] = [];
  let sinceCheck = 0;
  let lastWake = -Infinity;

  return {
    feed(samples16k) {
      for (const frame of stream.push(samples16k)) {
        recent.push(frame.mfcc);
        energies.push(frame.energy);
        if (recent.length > keep) {
          recent.shift();
          energies.shift();
        }
        if (++sinceCheck < CHECK_EVERY_FRAMES) continue;
        sinceCheck = 0;
        // Checks start once a word's worth of audio is in, so a "Voya" said right after
        // listening starts still counts.
        if (recent.length < longest || now() - lastWake < COOLDOWN_MS) continue;
        // Only when something was said just now: silence and steady noise never wake it.
        const tail = energies.slice(-RECENT_END_FRAMES);
        const quietest = Math.min(...energies);
        if (Math.max(...tail) < quietest + 12) continue;
        const best = Math.min(...templates.map((t) => matchCost(t, recent, RECENT_END_FRAMES)));
        if (best <= options.model.threshold) {
          lastWake = now();
          options.onWake();
        }
      }
    },
  };
}
