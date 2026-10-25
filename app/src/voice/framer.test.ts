import { describe, expect, it } from 'vitest';
import { createResampler } from './framer.ts';

describe('wake-word resampler', () => {
  it('turns 48 kHz into 16 kHz across chunk boundaries', () => {
    const resampler = createResampler(48000, 16000);
    let total = 0;
    for (let i = 0; i < 5; i++) total += resampler.push(new Float32Array(961).fill(0.5)).length;
    expect(total).toBe(Math.floor((5 * 961) / 3));
    expect(resampler.push(new Float32Array(3).fill(0.5))[0]).toBeCloseTo(0.5);
  });

  it('averages away content above the new Nyquist limit', () => {
    const resampler = createResampler(48000, 16000);
    // A 24 kHz alternating signal: inaudible to a 16 kHz model, must not alias into it.
    const input = Float32Array.from({ length: 12 }, (_, i) => (i % 2 ? 0.9 : -0.9));
    const out = resampler.push(input);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(0.35);
  });

  it('handles a 44.1 kHz microphone', () => {
    const resampler = createResampler(44100, 16000);
    const out = resampler.push(new Float32Array(44100).fill(-0.25));
    expect(out.length).toBe(16000);
    expect(out[100]).toBeCloseTo(-0.25);
  });
});
