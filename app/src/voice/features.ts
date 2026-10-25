// Speech features for the "Voya" wake word: 12 MFCCs (the standard compact description of the
// sound of speech) every 10 ms from 16 kHz audio, plus the frame's log energy. The first
// coefficient (overall loudness) is left out, so the same word matches whether said loudly or
// softly. Enrollment and live listening use this same streaming code, so their features match.

export const FEATURE_RATE = 16000;
const FRAME = 400; // 25 ms
export const HOP = 160; // 10 ms
const FFT_SIZE = 512;
const MELS = 26;
export const CEPSTRA = 12;

export type FeatureFrame = { mfcc: Float32Array; energy: number };

const hamming = Float32Array.from(
  { length: FRAME },
  (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1)),
);

const melOf = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const hzOf = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

// Triangular mel filters from 20 Hz to 7600 Hz, as [startBin, weights].
const filters: Array<{ start: number; weights: Float32Array }> = (() => {
  const low = melOf(20);
  const high = melOf(7600);
  const points = Array.from({ length: MELS + 2 }, (_, i) =>
    Math.floor(((FFT_SIZE + 1) * hzOf(low + ((high - low) * i) / (MELS + 1))) / FEATURE_RATE),
  );
  return Array.from({ length: MELS }, (_, m) => {
    const [a, b, c] = [points[m]!, points[m + 1]!, points[m + 2]!];
    const weights = new Float32Array(c - a + 1);
    for (let k = a; k <= c; k++) {
      weights[k - a] = k <= b ? (b === a ? 1 : (k - a) / (b - a)) : c === b ? 1 : (c - k) / (c - b);
    }
    return { start: a, weights };
  });
})();

const dct: Float32Array[] = Array.from({ length: CEPSTRA }, (_, i) =>
  Float32Array.from({ length: MELS }, (_, m) => Math.cos((Math.PI * (i + 1) * (m + 0.5)) / MELS)),
);

// In-place radix-2 FFT on (re, im) of length FFT_SIZE.
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

function frameFeatures(samples: Float32Array): FeatureFrame {
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  let energy = 0;
  for (let i = 0; i < FRAME; i++) {
    // Pre-emphasis lifts the high frequencies that carry consonants.
    const x = samples[i]! - 0.97 * (i > 0 ? samples[i - 1]! : 0);
    re[i] = x * hamming[i]!;
    energy += samples[i]! * samples[i]!;
  }
  fft(re, im);
  const logMel = new Float32Array(MELS);
  for (let m = 0; m < MELS; m++) {
    const { start, weights } = filters[m]!;
    let sum = 0;
    for (let k = 0; k < weights.length; k++) {
      const bin = start + k;
      sum += weights[k]! * (re[bin]! * re[bin]! + im[bin]! * im[bin]!);
    }
    logMel[m] = Math.log(sum + 1e-10);
  }
  const mfcc = Float32Array.from(dct, (row) => row.reduce((acc, w, m) => acc + w * logMel[m]!, 0));
  return { mfcc, energy: 10 * Math.log10(energy / FRAME + 1e-10) };
}

// Feed 16 kHz audio in any chunk size; get one feature frame per 10 ms.
export function createFeatureStream() {
  let buffer = new Float32Array(0);

  return {
    push(samples: Float32Array): FeatureFrame[] {
      const joined = new Float32Array(buffer.length + samples.length);
      joined.set(buffer);
      joined.set(samples, buffer.length);
      const frames: FeatureFrame[] = [];
      let offset = 0;
      for (; offset + FRAME <= joined.length; offset += HOP) {
        frames.push(frameFeatures(joined.subarray(offset, offset + FRAME)));
      }
      buffer = joined.slice(offset);
      return frames;
    },
  };
}
