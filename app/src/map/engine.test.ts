import { describe, expect, it } from 'vitest';
import type { Fixtures } from '../../../shared/types.ts';
import { CUE_RULES } from './cues.ts';
import { createMapEngine } from './engine.ts';
import { buildRouteLine, pointAtDistance } from './geo.ts';
import { feature, lDrive, L_ROUTE, offsetM, replay } from './testing.ts';

const SPEED = 10;
const arrivalMs = (routeDistM: number) => (routeDistM / SPEED) * 1000;

describe('map engine on a clean 1x drive', () => {
  const fixtures = lDrive({ speedMps: SPEED });

  it('fires each cue once, inside its window, before the feature', () => {
    const { decisions } = replay(createMapEngine(fixtures), 0, 60_000);
    expect(decisions.map((d) => d.cue.featureId)).toEqual(['stop-1', 'turn-1', 'crosswalk-1']);
    for (const d of decisions) {
      const f = fixtures.features.find((x) => x.id === d.cue.featureId);
      const [closesS, opensS] = CUE_RULES[d.cue.featureKind].windowS;
      expect(d.ttaS).toBeGreaterThanOrEqual(closesS);
      expect(d.ttaS).toBeLessThanOrEqual(opensS);
      expect(d.cue.earliestMs).toBeLessThan(arrivalMs(f?.routeDistM ?? 0));
      expect(d.cue.expiresMs).toBeLessThan(arrivalMs(f?.routeDistM ?? 0));
    }
    // Stop sign 150 m ahead, window opens at 9 s: progress 60 m, so about 6 s into the drive.
    expect(decisions[0]?.cue.earliestMs).toBeGreaterThanOrEqual(5900);
    expect(decisions[0]?.cue.earliestMs).toBeLessThanOrEqual(6200);
    expect(decisions[1]?.cue.text).toBe(
      'Left turn ahead onto Oak Street. Check for pedestrians before turning.',
    );
  });

  it('fires the same cues again after a reset (seek back)', () => {
    const engine = createMapEngine(fixtures);
    replay(engine, 0, 60_000);
    engine.reset();
    expect(replay(engine, 0, 60_000).decisions).toHaveLength(3);
  });

  it('never fires a cue for a feature already passed or too close after a seek forward', () => {
    const engine = createMapEngine(fixtures);
    engine.reset();
    // At 25 s: stop sign passed, turn only 5 s away (window closes at 6 s), crosswalk ahead.
    const { decisions } = replay(engine, 25_000, 60_000);
    expect(decisions.map((d) => d.cue.featureId)).toEqual(['crosswalk-1']);
  });

  it('needs a moving clock: no cue on the first update or while paused', () => {
    const engine = createMapEngine(fixtures);
    expect(engine.update(7000).decisions).toEqual([]);
    expect(engine.update(7000).decisions).toEqual([]);
    expect(engine.update(7100).decisions.map((d) => d.cue.featureId)).toEqual(['stop-1']);
  });

  it('lists the next three features with distances', () => {
    const engine = createMapEngine(fixtures);
    const { snapshot } = engine.update(10_000);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.upcoming.map((u) => [u.id, Math.round(u.distM)])).toEqual([
      ['stop-1', 50],
      ['turn-1', 200],
      ['crosswalk-1', 350],
    ]);
    expect(snapshot.accuracyM).toBe(5);
  });

  it('emits no position outside the recorded track', () => {
    const engine = createMapEngine(fixtures);
    const before = engine.update(-500);
    expect(before.position).toBeUndefined();
    expect(before.decisions).toEqual([]);
    expect(engine.update(70_000).snapshot.status).toBe('noPosition');
  });

  it('emits positions but no cues without a route', () => {
    const engine = createMapEngine({ ...fixtures, route: { coordinates: [] } });
    const out = engine.update(5000);
    expect(out.position?.speedMps).toBeCloseTo(SPEED, 6);
    expect(out.snapshot.status).toBe('noRoute');
  });
});

describe('map engine with bad GPS', () => {
  it('makes no cue while accuracy is over 25 m', () => {
    // Fixes 4-10 at 30 m accuracy cover the stop sign's whole window (6-9 s).
    const fixtures = lDrive({
      speedMps: SPEED,
      edit: (p, i) => (i >= 4 && i <= 10 ? { ...p, accuracyM: 30 } : p),
    });
    const { decisions, snapshots } = replay(createMapEngine(fixtures), 0, 60_000);
    expect(decisions.map((d) => d.cue.featureId)).toEqual(['turn-1', 'crosswalk-1']);
    expect(snapshots.find((s) => s.tripMs === 7000)?.snapshot.status).toBe('lowAccuracy');
  });

  it('makes no cue from a position that jumps backward', () => {
    // The signal at 200 m is skipped while accuracy is bad (11-20 s). At 30 s the fix jumps back
    // to 140 m, which would put the signal 6 s ahead, after the car has already passed it.
    const line = buildRouteLine(L_ROUTE);
    const back = pointAtDistance(line, 140);
    const fixtures: Fixtures = {
      ...lDrive({
        speedMps: SPEED,
        edit: (p, i) => {
          const q = { ...p, speedMps: SPEED };
          if (i >= 10 && i <= 20) q.accuracyM = 30;
          if (i === 30) Object.assign(q, back);
          return q;
        },
      }),
      features: [feature('signal-1', 'signal', 200)],
    };
    const { decisions, snapshots } = replay(createMapEngine(fixtures), 0, 60_000);
    expect(decisions).toEqual([]);
    expect(snapshots.find((s) => s.tripMs === 30_000)?.snapshot.status).toBe('backward');
  });

  it('makes no cue while off the route', () => {
    const fixtures = lDrive({
      speedMps: SPEED,
      edit: (p, i) => {
        // Pin the speed: displaced fixes would otherwise derive a 40 m/s spike.
        if (i < 4 || i > 10) return { ...p, speedMps: SPEED };
        const [lon, lat] = offsetM(i * SPEED, 80);
        return { ...p, lat, lon, speedMps: SPEED };
      },
    });
    const { decisions, snapshots } = replay(createMapEngine(fixtures), 0, 60_000);
    expect(decisions.map((d) => d.cue.featureId)).not.toContain('stop-1');
    expect(snapshots.find((s) => s.tripMs === 7000)?.snapshot.status).toBe('offRoute');
  });
});

describe('map engine on a route that uses the same street twice', () => {
  // 200 m east and back. Stop signs at 150 m (outbound) and 250 m (same spot, return trip).
  const route = { coordinates: [offsetM(0, 0), offsetM(200, 0), offsetM(0, 0)] };
  const line = buildRouteLine(route.coordinates);
  const points = Array.from({ length: 41 }, (_, i) => ({
    tMs: i * 1000,
    ...pointAtDistance(line, i * SPEED),
    speedMps: SPEED,
    accuracyM: 5,
  }));
  const stopAt = (id: string, routeDistM: number) => ({
    id,
    kind: 'stopSign' as const,
    ...pointAtDistance(line, routeDistM),
    routeDistM,
    source: 'osm' as const,
  });
  const fixtures: Fixtures = {
    track: { syncOffsetMs: 0, points },
    route,
    features: [stopAt('out', 150), stopAt('back', 250)],
  };

  it('fires both passes once, each before its own arrival', () => {
    const { decisions } = replay(createMapEngine(fixtures), 0, 40_000);
    expect(decisions.map((d) => d.cue.featureId)).toEqual(['out', 'back']);
    expect(decisions[1]?.cue.earliestMs).toBeLessThan(25_000);
  });

  it('matches the return pass after a seek, using distance travelled', () => {
    const engine = createMapEngine(fixtures);
    expect(engine.update(30_000).snapshot.progressM).toBeCloseTo(300, 0);
  });
});
