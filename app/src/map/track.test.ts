import { describe, expect, it } from 'vitest';
import { interpolateTrack, odometer, odometerAt, withMotion } from './track.ts';
import { offsetM } from './testing.ts';

const at = (tMs: number, eastM: number, northM: number, extra = {}) => {
  const [lon, lat] = offsetM(eastM, northM);
  return { tMs, lat, lon, ...extra };
};

describe('withMotion', () => {
  it('derives speed and heading where missing, keeping given values', () => {
    const points = withMotion([at(0, 0, 0), at(1000, 10, 0), at(2000, 20, 0, { speedMps: 7 })]);
    expect(points[0]?.speedMps).toBeCloseTo(10, 1);
    expect(points[1]?.speedMps).toBeCloseTo(10, 1);
    expect(points[2]?.speedMps).toBe(7);
    points.forEach((p) => expect(p.headingDeg).toBeCloseTo(90, 0));
  });

  it('sorts, drops duplicate times and treats -1 as unknown', () => {
    const points = withMotion([
      at(1000, 10, 0, { speedMps: -1, headingDeg: -1, accuracyM: -1 }),
      at(0, 0, 0),
      at(1000, 99, 0),
    ]);
    expect(points.map((p) => p.tMs)).toEqual([0, 1000]);
    expect(points[1]?.speedMps).toBeCloseTo(10, 1);
    expect(points[1]?.headingDeg).toBeCloseTo(90, 0);
    expect(points[1]?.accuracyM).toBeUndefined();
  });

  it('holds the last heading while stopped instead of using jitter', () => {
    // Driving north, then three fixes wandering under a metre while stopped.
    const points = withMotion([
      at(0, 0, 0),
      at(1000, 0, 10),
      at(2000, 0, 20),
      at(3000, 0.3, 20.2),
      at(4000, 0.5, 20.1),
    ]);
    expect(points[2]?.headingDeg).toBeLessThan(5);
    expect(points[3]?.headingDeg).toBe(points[2]?.headingDeg);
    expect(points[4]?.headingDeg).toBe(points[2]?.headingDeg);
  });
});

describe('interpolateTrack', () => {
  const points = withMotion([
    at(0, 0, 0, { speedMps: 8, headingDeg: 350, accuracyM: 5 }),
    at(1000, 0, 10, { speedMps: 12, headingDeg: 10, accuracyM: 30 }),
  ]);

  it('interpolates position, speed, heading and takes the worse accuracy', () => {
    const pos = interpolateTrack(points, 500);
    const [lon, lat] = offsetM(0, 5);
    expect(pos?.lat).toBeCloseTo(lat, 7);
    expect(pos?.lon).toBeCloseTo(lon, 7);
    expect(pos?.speedMps).toBeCloseTo(10, 6);
    expect(pos?.headingDeg).toBeCloseTo(0, 6);
    expect(pos?.accuracyM).toBe(30);
    expect(pos?.tripMs).toBe(500);
  });

  it('returns the exact point at the ends and nothing outside the recording', () => {
    expect(interpolateTrack(points, 0)?.speedMps).toBe(8);
    expect(interpolateTrack(points, 1000)?.speedMps).toBe(12);
    expect(interpolateTrack(points, -1)).toBeUndefined();
    expect(interpolateTrack(points, 1001)).toBeUndefined();
    expect(interpolateTrack([], 0)).toBeUndefined();
  });

  it('omits accuracy when the track has none', () => {
    const plain = withMotion([at(0, 0, 0), at(1000, 0, 10)]);
    expect(interpolateTrack(plain, 500)).not.toHaveProperty('accuracyM');
  });
});

describe('odometer', () => {
  it('accumulates distance and interpolates it in time', () => {
    const points = withMotion([at(0, 0, 0), at(1000, 10, 0), at(2000, 10, 10)]);
    const cum = odometer(points);
    expect(cum[2]).toBeCloseTo(20, 1);
    expect(odometerAt(points, cum, 1500)).toBeCloseTo(15, 1);
    expect(odometerAt(points, cum, 5000)).toBeCloseTo(20, 1);
    expect(odometerAt(points, cum, -100)).toBe(0);
  });
});
