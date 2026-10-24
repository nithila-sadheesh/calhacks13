// Test helpers only (imported by *.test.ts, never by the app): a synthetic L-shaped drive and a
// replay loop that steps the engine like the real module does at 1x.
import type { Fixtures, MapFeature, TrackPoint } from '../../../shared/types.ts';
import type { CueDecision } from './cues.ts';
import type { MapEngine, MapSnapshot } from './engine.ts';
import { buildRouteLine, pointAtDistance, type LonLat } from './geo.ts';

const ORIGIN = { lat: 37.87, lon: -122.27 };
// Same earth radius as geo.ts, so offsets in metres match measured distances.
const M_PER_DEG_LAT = (6_371_008.8 * Math.PI) / 180;

export function offsetM(eastM: number, northM: number): LonLat {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
  return [ORIGIN.lon + eastM / mPerDegLon, ORIGIN.lat + northM / M_PER_DEG_LAT];
}

// 300 m east, then a left turn onto Oak Street and 300 m north.
export const L_ROUTE: LonLat[] = [offsetM(0, 0), offsetM(300, 0), offsetM(300, 300)];

export function feature(id: string, kind: MapFeature['kind'], routeDistM: number, street?: string) {
  const { lat, lon } = pointAtDistance(buildRouteLine(L_ROUTE), routeDistM);
  const f: MapFeature = { id, kind, lat, lon, routeDistM, source: 'osm' };
  if (street) f.street = street;
  return f;
}

export const L_FEATURES: MapFeature[] = [
  feature('stop-1', 'stopSign', 150),
  feature('turn-1', 'turnLeft', 300, 'Oak Street'),
  feature('crosswalk-1', 'crosswalk', 450),
];

// Constant-speed drive along L_ROUTE with one fix per second. `edit` adjusts single points.
export function lDrive(
  options: {
    speedMps?: number;
    accuracyM?: number;
    edit?: (p: TrackPoint, i: number) => TrackPoint;
  } = {},
): Fixtures {
  const { speedMps = 10, accuracyM = 5, edit = (p) => p } = options;
  const line = buildRouteLine(L_ROUTE);
  const points: TrackPoint[] = [];
  for (let i = 0; i * speedMps <= line.lengthM; i++) {
    const { lat, lon } = pointAtDistance(line, i * speedMps);
    points.push(edit({ tMs: i * 1000, lat, lon, accuracyM }, i));
  }
  return {
    track: { syncOffsetMs: 0, points },
    features: L_FEATURES,
    route: { coordinates: L_ROUTE },
  };
}

export type ReplayResult = {
  decisions: CueDecision[];
  snapshots: Array<{ tripMs: number; snapshot: MapSnapshot }>;
};

export function replay(engine: MapEngine, fromMs: number, toMs: number, stepMs = 100) {
  const result: ReplayResult = { decisions: [], snapshots: [] };
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const { decisions, snapshot } = engine.update(t);
    result.decisions.push(...decisions);
    result.snapshots.push({ tripMs: t, snapshot });
  }
  return result;
}
