// Acceptance tests on the committed drive fixtures (docs/DESIGN.md, "Acceptance tests": track
// sync and cue timing). Reads annotations.json from disk, which only tests may do.
// Conventions for annotations.json are in NOTES.md.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Fixtures, MapFeature, MapFeatureKind, Route, Track } from '../../../shared/types.ts';
import { cueText } from './cues.ts';
import { createMapEngine } from './engine.ts';
import { buildRouteLine, distanceM, pointAtDistance } from './geo.ts';
import { replay } from './testing.ts';
import { interpolateTrack, withMotion } from './track.ts';

type Annotations = {
  landmarks: Array<{ tripMs: number; label: string }>;
  expected: Array<{ tripMs: number; kind: string }>;
};

const load = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/demo-drive/${name}`, import.meta.url), 'utf8'),
  ) as T;

const fixtures: Fixtures = {
  track: load<Track>('track.json'),
  features: load<MapFeature[]>('features.json'),
  route: load<Route>('route.json'),
};
const annotations = load<Annotations>('annotations.json');
const line = buildRouteLine(fixtures.route.coordinates);
const points = withMotion(fixtures.track.points);
const endMs = points.at(-1)?.tMs ?? 0;
const MAP_KINDS: string[] = ['turnLeft', 'turnRight', 'stopSign', 'crosswalk', 'signal'];

// One 1x replay at 10 Hz from the start, as the module runs it.
const run = replay(createMapEngine(fixtures), 0, endMs);
const arrivalMs = (f: MapFeature) =>
  run.snapshots.find((s) => (s.snapshot.progressM ?? -Infinity) >= f.routeDistM)?.tripMs;

describe('drive fixtures', () => {
  it('have a route, a time-ordered track and unique feature ids', () => {
    expect(fixtures.route.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(points.length).toBe(fixtures.track.points.length);
    const ids = fixtures.features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('place every feature where its routeDistM says, within 30 m of the route', () => {
    for (const f of fixtures.features) {
      expect(f.routeDistM, f.id).toBeGreaterThanOrEqual(0);
      expect(f.routeDistM, f.id).toBeLessThanOrEqual(line.lengthM);
      const p = pointAtDistance(line, f.routeDistM);
      expect(distanceM(p.lat, p.lon, f.lat, f.lon), f.id).toBeLessThanOrEqual(30);
    }
  });

  it('mark every hand fix as curated with a note, and name every turn', () => {
    for (const f of fixtures.features) {
      if (f.source === 'curated') expect(f.note?.trim(), f.id).toBeTruthy();
      if (f.kind === 'turnLeft' || f.kind === 'turnRight')
        expect(f.street?.trim(), f.id).toBeTruthy();
    }
  });
});

describe('track sync (landmarks labelled with a feature id)', () => {
  const byId = new Map(fixtures.features.map((f) => [f.id, f]));
  const landmarks = annotations.landmarks.filter((l) => byId.has(l.label));

  if (landmarks.length === 0)
    it.skip('needs two landmarks in annotations.json labelled with feature ids (NOTES.md)');
  it.each(landmarks)('position reaches $label within 1 s of the video ($tripMs ms)', (l) => {
    const f = byId.get(l.label);
    if (!f) return;
    // Closest approach to the feature within 10 s of the annotated moment.
    let best = { tMs: NaN, d: Infinity };
    for (let t = l.tripMs - 10_000; t <= l.tripMs + 10_000; t += 50) {
      const p = interpolateTrack(points, t);
      const d = p ? distanceM(p.lat, p.lon, f.lat, f.lon) : Infinity;
      if (d < best.d) best = { tMs: t, d };
    }
    expect(best.d).toBeLessThan(30);
    expect(Math.abs(best.tMs - l.tripMs)).toBeLessThanOrEqual(1000);
  });
});

describe('cue timing on a 1x replay', () => {
  const passed = fixtures.features.filter(
    (f) => cueText(f.kind, f.street) !== undefined && arrivalMs(f) !== undefined,
  );

  it('never cues a feature twice', () => {
    const ids = run.decisions.map((d) => d.cue.featureId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(passed.map((f) => [f.id, f] as const))('%s is cued once, before arrival', (_, f) => {
    const cues = run.decisions.filter((d) => d.cue.featureId === f.id);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.cue.earliestMs).toBeLessThan(arrivalMs(f) ?? -Infinity);
  });

  const expectedCues = annotations.expected.filter((e) => MAP_KINDS.includes(e.kind));
  if (expectedCues.length === 0)
    it.skip('needs expected map features in annotations.json (NOTES.md)');
  it.each(expectedCues)('a $kind cue fires in the 12 s before $tripMs ms', (e) => {
    const hit = run.decisions.find(
      (d) =>
        d.cue.featureKind === (e.kind as MapFeatureKind) &&
        d.cue.earliestMs < e.tripMs &&
        d.cue.earliestMs >= e.tripMs - 12_000,
    );
    expect(hit, `no ${e.kind} cue before ${e.tripMs} ms`).toBeDefined();
  });
});
