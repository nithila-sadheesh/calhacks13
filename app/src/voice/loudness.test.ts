import { describe, expect, it } from 'vitest';
import { softClipCurve } from './loudness.ts';

describe('soft clip curve', () => {
  const curve = softClipCurve(2001);
  const at = (x: number) => curve[Math.round(((x + 1) / 2) * 2000)]!;

  it('leaves normal speech levels untouched', () => {
    expect(at(0)).toBeCloseTo(0);
    expect(at(0.3)).toBeCloseTo(0.3);
    expect(at(-0.5)).toBeCloseTo(-0.5);
  });

  it('rounds off peaks and never reaches full scale', () => {
    expect(at(0.8)).toBeLessThan(0.8);
    expect(at(0.8)).toBeGreaterThan(0.6);
    expect(Math.max(...curve.map(Math.abs))).toBeLessThan(1);
  });

  it('keeps getting louder as the input does, with no fold-back', () => {
    for (let i = 1; i < curve.length; i++) expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
  });
});
