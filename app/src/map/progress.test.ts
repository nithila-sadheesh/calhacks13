import { describe, expect, it } from 'vitest';
import type { Position } from '../../../shared/types.ts';
import { buildRouteLine } from './geo.ts';
import { advanceProgress, type ProgressState } from './progress.ts';
import { L_ROUTE, offsetM } from './testing.ts';

const line = buildRouteLine(L_ROUTE);

const pos = (tripMs: number, eastM: number, northM: number, extra: Partial<Position> = {}) => {
  const [lon, lat] = offsetM(eastM, northM);
  return { tripMs, lat, lon, speedMps: 10, headingDeg: 90, accuracyM: 5, ...extra };
};

const tracking: ProgressState = { progressM: 100, acceptedMs: 10_000 };

describe('advanceProgress', () => {
  it('acquires the route on the first position', () => {
    const step = advanceProgress(line, {}, pos(0, 40, 3), 0);
    expect(step.status).toBe('ok');
    expect(step.state.progressM).toBeCloseTo(40, 0);
    expect(step.state.acceptedMs).toBe(0);
  });

  it('moves forward with plausible positions', () => {
    const step = advanceProgress(line, tracking, pos(11_000, 110, 0), 0);
    expect(step.status).toBe('ok');
    expect(step.state.progressM).toBeCloseTo(110, 0);
  });

  it('keeps the furthest progress through small backward jitter', () => {
    const step = advanceProgress(line, tracking, pos(10_100, 97, 0), 0);
    expect(step.status).toBe('ok');
    expect(step.state.progressM).toBe(100);
  });

  it('skips positions with accuracy over 25 m', () => {
    const step = advanceProgress(line, tracking, pos(11_000, 110, 0, { accuracyM: 26 }), 0);
    expect(step.status).toBe('lowAccuracy');
    expect(step.state).toBe(tracking);
  });

  it('accepts exactly 25 m accuracy', () => {
    const step = advanceProgress(line, tracking, pos(11_000, 110, 0, { accuracyM: 25 }), 0);
    expect(step.status).toBe('ok');
  });

  it('rejects a backward jump without moving progress', () => {
    const step = advanceProgress(line, tracking, pos(11_000, 60, 0), 0);
    expect(step.status).toBe('backward');
    expect(step.state).toBe(tracking);
  });

  it('matches afresh after a backward jump that lasts 5 s', () => {
    const step = advanceProgress(line, tracking, pos(15_000, 60, 0), 0);
    expect(step.status).toBe('backward');
    expect(step.state).toEqual({});
  });

  it('rejects an implausible forward jump', () => {
    const step = advanceProgress(line, tracking, pos(10_100, 250, 0), 0);
    expect(step.status).toBe('jump');
    expect(step.state).toBe(tracking);
  });

  it('allows a long forward move after a long gap', () => {
    const step = advanceProgress(line, tracking, pos(25_000, 250, 0), 0);
    expect(step.status).toBe('ok');
    expect(step.state.progressM).toBeCloseTo(250, 0);
  });

  it('reports positions far from the route as off route', () => {
    const step = advanceProgress(line, tracking, pos(11_000, 110, 60), 0);
    expect(step.status).toBe('offRoute');
    expect(step.state).toBe(tracking);
  });
});
