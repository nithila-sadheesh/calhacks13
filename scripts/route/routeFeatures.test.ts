import { describe, expect, it } from 'vitest';
import { buildRouteLine, type LonLat } from '../../app/src/map/geo.ts';
import { L_ROUTE, offsetM } from '../../app/src/map/testing.ts';
import type { MapFeature } from '../../shared/types.ts';
import {
  buildFixtures,
  classifyNode,
  dedupe,
  drivesWayForward,
  nearRouteNodeIds,
  parseCurated,
  parseOsrm,
  routeBearingAt,
  routePasses,
  sampleWaypoints,
  trackDeviation,
  turnKind,
  type CuratedFile,
  type OsmNode,
  type OsmWay,
  type OsrmResponse,
  type OsrmStep,
} from './routeFeatures.ts';

const at = (eastM: number, northM: number) => {
  const [lon, lat] = offsetM(eastM, northM);
  return { lat, lon };
};

const osrmFor = (
  coordinates: LonLat[],
  distance: number,
  steps: OsrmStep[] = [],
): OsrmResponse => ({
  code: 'Ok',
  routes: [{ distance, geometry: { coordinates }, legs: [{ distance, steps }] }],
});

// The L-shaped test route: 300 m east on Main Street, left onto Oak Street, 300 m north.
const OSRM = osrmFor(L_ROUTE, 600, [
  { name: 'Main Street', distance: 300, maneuver: { type: 'depart', location: offsetM(0, 0) } },
  {
    name: 'Oak Street',
    distance: 300,
    maneuver: { type: 'turn', modifier: 'left', location: offsetM(300, 0) },
  },
  { name: 'Oak Street', distance: 0, maneuver: { type: 'arrive', location: offsetM(300, 300) } },
]);

const node = (id: number, pos: { lat: number; lon: number }, tags: Record<string, string>) =>
  ({ type: 'node', id, ...pos, tags }) as OsmNode;
const way = (id: number, nodes: number[], geometry: Array<{ lat: number; lon: number }>) =>
  ({ type: 'way', id, nodes, geometry }) as OsmWay;

const OSM_NODES: OsmNode[] = [
  node(2, at(100, 0), { highway: 'stop' }),
  node(3, at(200, 0), { highway: 'traffic_signals', direction: 'forward' }),
  node(5, at(300, 100), { highway: 'crossing', crossing: 'marked' }),
  node(6, at(300, 200), { highway: 'crossing', crossing: 'unmarked' }),
  node(7, at(300, 300), { highway: 'traffic_signals', direction: 'backward' }),
  // A cross street's stop sign 8 m from Main Street: near the route, not on it.
  node(98, at(100, 8), { highway: 'stop' }),
  // A crossing 3 m from Main Street, but only on a footway that crosses it.
  node(96, at(200, 3), { highway: 'crossing', crossing: 'zebra' }),
];
const WAYS: OsmWay[] = [
  way(20, [1, 2, 3, 4], [at(0, 0), at(100, 0), at(200, 0), at(300, 0)]),
  way(21, [4, 5, 6, 7], [at(300, 0), at(300, 100), at(300, 200), at(300, 300)]),
  way(23, [97, 98, 2], [at(100, 30), at(100, 8), at(100, 0)]),
  way(24, [95, 96], [at(200, 10), at(200, 3)]),
];
const NO_CURATION: CuratedFile = { remove: [], add: [] };

describe('parseOsrm', () => {
  it('reads the geometry and turns with streets', () => {
    const parsed = parseOsrm(OSRM);
    expect(parsed.coordinates).toEqual(L_ROUTE);
    expect(parsed.turns).toEqual([
      expect.objectContaining({
        id: 'turnLeft-1',
        kind: 'turnLeft',
        street: 'Oak Street',
        hintM: 300,
      }),
    ]);
  });

  it('counts step distances across legs', () => {
    const turnAt = (location: LonLat): OsrmStep => ({
      name: 'X',
      distance: 50,
      maneuver: { type: 'turn', modifier: 'right', location },
    });
    const parsed = parseOsrm({
      code: 'Ok',
      routes: [
        {
          distance: 200,
          geometry: { coordinates: L_ROUTE },
          legs: [
            { distance: 100, steps: [turnAt(offsetM(0, 0)), turnAt(offsetM(50, 0))] },
            { distance: 100, steps: [turnAt(offsetM(100, 0))] },
          ],
        },
      ],
    });
    expect(parsed.turns.map((t) => [t.id, t.hintM])).toEqual([
      ['turnRight-1', 0],
      ['turnRight-2', 50],
      ['turnRight-3', 100],
    ]);
  });

  it('throws on an OSRM error', () => {
    expect(() => parseOsrm({ code: 'NoRoute', message: 'Impossible route' })).toThrow(/NoRoute/);
  });
});

describe('classification', () => {
  it('maps maneuvers to turn kinds', () => {
    expect(turnKind('turn', 'left')).toBe('turnLeft');
    expect(turnKind('end of road', 'sharp right')).toBe('turnRight');
    expect(turnKind('turn', 'slight left')).toBeUndefined();
    expect(turnKind('fork', 'left')).toBeUndefined();
    expect(turnKind('roundabout', 'right')).toBeUndefined();
  });

  it('maps OSM tags to feature kinds, skipping unmarked crossings', () => {
    expect(classifyNode({ highway: 'stop' })).toBe('stopSign');
    expect(classifyNode({ highway: 'traffic_signals' })).toBe('signal');
    expect(classifyNode({ highway: 'crossing', crossing: 'zebra' })).toBe('crosswalk');
    expect(classifyNode({ highway: 'crossing' })).toBe('crosswalk');
    expect(classifyNode({ highway: 'crossing', crossing: 'unmarked' })).toBeUndefined();
    expect(classifyNode({ highway: 'crossing', 'crossing:markings': 'no' })).toBeUndefined();
    expect(classifyNode({ highway: 'give_way' })).toBeUndefined();
    expect(classifyNode()).toBeUndefined();
  });

  it('tells which way along an OSM way we drive, from bearings', () => {
    const eastward = way(1, [2, 3, 4], [at(100, 0), at(200, 0), at(300, 0)]);
    expect(drivesWayForward(eastward, 3, 90)).toBe(true);
    expect(drivesWayForward(eastward, 4, 100)).toBe(true);
    expect(drivesWayForward(eastward, 3, 265)).toBe(false);
    // Crossing it, not driving along it.
    expect(drivesWayForward(eastward, 3, 0)).toBeUndefined();
    expect(drivesWayForward(eastward, 9, 90)).toBeUndefined();
    expect(drivesWayForward({ ...eastward, geometry: undefined }, 3, 90)).toBeUndefined();
  });

  it('measures travel direction along the route', () => {
    const line = buildRouteLine(L_ROUTE);
    expect(routeBearingAt(line, 100)).toBeCloseTo(90, 0);
    expect(routeBearingAt(line, 450)).toBeCloseTo(0, 0);
    expect(routeBearingAt(line, 600)).toBeCloseTo(0, 0);
  });

  it('finds each pass of the route over a point, once at a corner', () => {
    const line = buildRouteLine(L_ROUTE);
    expect(routePasses(line, at(300, 0).lat, at(300, 0).lon).map(Math.round)).toEqual([300]);
    expect(routePasses(line, at(100, 8).lat, at(100, 8).lon)).toEqual([]);
    const outAndBack = buildRouteLine([offsetM(0, 0), offsetM(200, 0), offsetM(0, 0)]);
    expect(routePasses(outAndBack, at(50, 1).lat, at(50, 1).lon).map(Math.round)).toEqual([
      50, 350,
    ]);
  });

  it('lists feature nodes touching the route for the way lookup', () => {
    expect(nearRouteNodeIds(buildRouteLine(L_ROUTE), OSM_NODES)).toEqual([2, 3, 5, 7, 96]);
  });
});

describe('buildFixtures', () => {
  it('keeps features on our road facing us, in route order', () => {
    const { route, features, warnings } = buildFixtures({
      osrm: OSRM,
      osmNodes: OSM_NODES,
      ways: WAYS,
      curated: NO_CURATION,
    });
    expect(route.coordinates).toHaveLength(3);
    expect(features.map((f) => [f.id, f.kind, Math.round(f.routeDistM)])).toEqual([
      ['stopSign-2', 'stopSign', 100],
      ['signal-3', 'signal', 200],
      ['turnLeft-1', 'turnLeft', 300],
      ['crosswalk-5', 'crosswalk', 400],
    ]);
    expect(features.find((f) => f.id === 'turnLeft-1')).toMatchObject({
      source: 'osrm',
      street: 'Oak Street',
    });
    expect(features[0]).toMatchObject({ source: 'osm', note: 'OSM node 2' });
    expect(warnings).toEqual([expect.stringContaining('node/2 has no direction tag')]);
  });

  it('keeps a node with no way geometry but warns', () => {
    const { features, warnings } = buildFixtures({
      osrm: OSRM,
      osmNodes: [node(50, at(50, 0), { highway: 'crossing' })],
      ways: [],
      curated: NO_CURATION,
    });
    expect(features.map((f) => f.id)).toEqual(['crosswalk-50', 'turnLeft-1']);
    expect(warnings).toEqual([expect.stringContaining('no way geometry')]);
  });

  it('handles a route that passes the same spot twice, honouring direction', () => {
    // Out 200 m east and back. A crossing at 50 m is on both passes; a stop sign at 120 m tagged
    // forward only applies on the way out.
    const coords = [offsetM(0, 0), offsetM(200, 0), offsetM(0, 0)];
    const { features } = buildFixtures({
      osrm: osrmFor(coords, 400),
      osmNodes: [
        node(11, at(50, 0), { highway: 'crossing' }),
        node(13, at(120, 0), { highway: 'stop', direction: 'forward' }),
      ],
      ways: [way(30, [10, 11, 13, 12], [at(0, 0), at(50, 0), at(120, 0), at(200, 0)])],
      curated: NO_CURATION,
    });
    expect(features.map((f) => [f.id, Math.round(f.routeDistM)])).toEqual([
      ['crosswalk-11', 50],
      ['stopSign-13', 120],
      ['crosswalk-11-2', 350],
    ]);
  });

  it('applies curated removals and additions, marked curated', () => {
    const { features } = buildFixtures({
      osrm: OSRM,
      osmNodes: OSM_NODES,
      ways: WAYS,
      curated: {
        remove: ['signal-3'],
        add: [{ id: 'curated-stop-1', kind: 'stopSign', ...at(302, 150), note: 'Missing in OSM' }],
      },
    });
    expect(features.map((f) => f.id)).toEqual([
      'stopSign-2',
      'turnLeft-1',
      'crosswalk-5',
      'curated-stop-1',
    ]);
    expect(features.at(-1)).toMatchObject({ source: 'curated', note: 'Missing in OSM' });
    expect(features.at(-1)?.routeDistM).toBeCloseTo(450, 0);
  });

  it('refuses a curated feature off the route and warns on unknown removals', () => {
    const off = { id: 'x', kind: 'crosswalk' as const, ...at(100, 80), note: 'test' };
    expect(() =>
      buildFixtures({ osrm: OSRM, osmNodes: [], ways: [], curated: { remove: [], add: [off] } }),
    ).toThrow(/curated\.json: x/);
    const { warnings } = buildFixtures({
      osrm: OSRM,
      osmNodes: [],
      ways: [],
      curated: { remove: ['nope'], add: [] },
    });
    expect(warnings).toContain('curated.json removes nope, which was not generated');
  });

  it('warns about turns without a street name', () => {
    const unnamed = structuredClone(OSRM);
    const step = unnamed.routes?.[0]?.legs[0]?.steps[1];
    if (step) step.name = '';
    const { features, warnings } = buildFixtures({
      osrm: unnamed,
      osmNodes: [],
      ways: [],
      curated: NO_CURATION,
    });
    expect(features[0]?.street).toBeUndefined();
    expect(warnings[0]).toMatch(/turnLeft-1 .* no street name/);
  });
});

describe('helpers', () => {
  it('merges same-kind features closer than 30 m, never turns', () => {
    const f = (id: string, kind: MapFeature['kind'], routeDistM: number): MapFeature => ({
      id,
      kind,
      lat: 0,
      lon: 0,
      routeDistM,
      source: 'osm',
    });
    const kept = dedupe([
      f('a', 'crosswalk', 100),
      f('b', 'crosswalk', 120),
      f('c', 'signal', 125),
      f('d', 'crosswalk', 160),
      f('e', 'turnLeft', 300),
      f('g', 'turnLeft', 310),
    ]);
    expect(kept.map((x) => x.id)).toEqual(['a', 'c', 'd', 'e', 'g']);
  });

  it('validates curated.json', () => {
    expect(parseCurated({})).toEqual({ remove: [], add: [] });
    expect(() => parseCurated({ add: [{ id: 'a', kind: 'stopSign', lat: 1, lon: 2 }] })).toThrow(
      /note/,
    );
    expect(() =>
      parseCurated({ add: [{ id: 'a', kind: 'yield', lat: 1, lon: 2, note: 'x' }] }),
    ).toThrow();
    expect(() => parseCurated({ remove: [3] })).toThrow();
    expect(() => parseCurated(null)).toThrow();
  });

  it('samples evenly spaced waypoints including both ends', () => {
    const points = Array.from({ length: 61 }, (_, i) => at(i * 10, 0));
    const lonLat = (k: number) => [points[k]?.lon, points[k]?.lat];
    expect(sampleWaypoints(points, 4)).toEqual([0, 20, 40, 60].map(lonLat));
    expect(sampleWaypoints(points.slice(0, 3), 5)).toHaveLength(3);
  });

  it('measures how far a track strays from the route', () => {
    const route = { coordinates: L_ROUTE };
    expect(trackDeviation(route, [at(50, 2), at(300, 50)]).maxOffsetM).toBeCloseTo(2, 0);
    const off = trackDeviation(route, [at(50, 2), at(100, 60)]);
    expect(off.maxOffsetM).toBeCloseTo(60, 0);
    expect(off.farShare).toBe(0.5);
  });
});
