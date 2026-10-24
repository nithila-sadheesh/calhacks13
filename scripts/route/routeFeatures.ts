// Route and feature building, as pure functions (fetchRoute.ts does the network calls).
// Input: one OSRM route with steps, OSM nodes from Overpass with the ways (and their geometry)
// that contain them, and hand fixes from curated.json.
//
// Whether an OSM node is on our path is decided by geometry only: it must lie on the route line
// and on a way we drive along there. OSRM's node-id annotations are not used, because the public
// OSRM server reports wrong ids for newer (large-id) OSM nodes. Output: route.json and
// features.json contents plus warnings to read before trusting them.
import {
  bearingDeg,
  buildRouteLine,
  nearestMatch,
  pointAtDistance,
  segmentMatches,
  type LonLat,
  type RouteLine,
  type RouteMatch,
} from '../../app/src/map/geo.ts';
import type { MapFeature, MapFeatureKind, Route } from '../../shared/types.ts';

export type OsrmStep = {
  name?: string;
  distance: number;
  maneuver: { type: string; modifier?: string; location: LonLat };
};
export type OsrmLeg = { distance: number; steps: OsrmStep[] };
export type OsrmResponse = {
  code: string;
  message?: string;
  routes?: Array<{ distance: number; geometry: { coordinates: LonLat[] }; legs: OsrmLeg[] }>;
};

export type OsmNode = {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};
// `geometry` (from Overpass `out geom`) holds one position per entry in `nodes`.
export type OsmWay = {
  type: 'way';
  id: number;
  nodes: number[];
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
};

export type CuratedFile = {
  remove: string[];
  add: Array<{
    id: string;
    kind: MapFeatureKind;
    lat: number;
    lon: number;
    street?: string;
    note: string;
    nearRouteDistM?: number; // which pass, when the route uses the same street twice
  }>;
};

// OSRM's geometry follows OSM ways exactly, so a node on a way we drive is within a metre or two
// of the line. Stop signs on a cross street sit further out and fail this.
const ON_ROUTE_M = 5;
// Turns (OSRM) and curated additions may sit a little off the line, but no further than this.
const MAX_FEATURE_OFFSET_M = 30;
// Search this far either side of a distance hint when placing a feature.
const PLACEMENT_WINDOW_M = 80;
// Two projections of one node further apart than this along the route are separate passes.
const SEPARATE_PASS_M = 30;
// Two features of the same kind closer than this are one real-world thing (both sides of a
// crosswalk, the signal heads of a divided road).
const SAME_FEATURE_GAP_M = 30;

const KINDS: MapFeatureKind[] = ['turnLeft', 'turnRight', 'stopSign', 'crosswalk', 'signal'];
const TURN_TYPES = new Set(['turn', 'end of road', 'continue']);

export type Candidate = Omit<MapFeature, 'routeDistM'> & { hintM?: number };

export type ParsedRoute = { coordinates: LonLat[]; turns: Candidate[] };

export function turnKind(type: string, modifier?: string): 'turnLeft' | 'turnRight' | undefined {
  if (!TURN_TYPES.has(type)) return undefined;
  if (modifier === 'left' || modifier === 'sharp left') return 'turnLeft';
  if (modifier === 'right' || modifier === 'sharp right') return 'turnRight';
  return undefined;
}

export function parseOsrm(json: OsrmResponse): ParsedRoute {
  const route = json.routes?.[0];
  if (json.code !== 'Ok' || !route)
    throw new Error(`OSRM: ${json.code}${json.message ? ` (${json.message})` : ''}`);

  const turns: Candidate[] = [];
  let legStartM = 0;
  route.legs.forEach((leg) => {
    let stepStartM = legStartM;
    leg.steps.forEach((step) => {
      const kind = turnKind(step.maneuver.type, step.maneuver.modifier);
      if (kind) {
        const [lon, lat] = step.maneuver.location;
        const turn: Candidate = { id: '', kind, lat, lon, source: 'osrm', hintM: stepStartM };
        const street = step.name?.trim();
        if (street) turn.street = street;
        turns.push(turn);
      }
      stepStartM += step.distance;
    });
    legStartM += leg.distance;
  });

  turns.forEach((t, i) => (t.id = `${t.kind}-${i + 1}`));
  return { coordinates: route.geometry.coordinates, turns };
}

// Which feature an OSM node is, if any. Unmarked crossings are not crosswalks.
export function classifyNode(tags: Record<string, string> = {}): MapFeatureKind | undefined {
  if (tags.highway === 'stop') return 'stopSign';
  if (tags.highway === 'traffic_signals') return 'signal';
  if (tags.highway === 'crossing') {
    if (['no', 'unmarked', 'informal'].includes(tags.crossing ?? '')) return undefined;
    if (tags['crossing:markings'] === 'no') return undefined;
    return 'crosswalk';
  }
  return undefined;
}

export function directionTag(
  tags: Record<string, string> = {},
): 'forward' | 'backward' | undefined {
  const d = tags.direction ?? tags['traffic_signals:direction'];
  return d === 'forward' || d === 'backward' ? d : undefined;
}

// Within this angle of the way's direction we drive with it; within this of the opposite
// direction, against it. Anything between means we cross the way rather than drive along it.
const ALIGNED_DEG = 60;

// Travel direction along the route at a distance, from points 5 m either side.
export function routeBearingAt(line: RouteLine, distM: number): number {
  const a = pointAtDistance(line, Math.max(0, distM - 5));
  const b = pointAtDistance(line, Math.min(line.lengthM, distM + 5));
  return bearingDeg(a.lat, a.lon, b.lat, b.lon);
}

// Whether we drive along the way in its node order at this node, by comparing its direction there
// with ours. Undefined when we cross the way instead, or it has no geometry.
export function drivesWayForward(
  way: OsmWay,
  nodeId: number,
  travelDeg: number,
): boolean | undefined {
  const i = way.nodes.indexOf(nodeId);
  const g = way.geometry;
  if (i === -1 || !g || g.length !== way.nodes.length) return undefined;
  const a = g[i + 1] ? g[i] : g[i - 1];
  const b = g[i + 1] ? g[i + 1] : g[i];
  if (!a || !b || a === b) return undefined;
  const wayDeg = bearingDeg(a.lat, a.lon, b.lat, b.lon);
  const diff = Math.abs(((((travelDeg - wayDeg) % 360) + 540) % 360) - 180);
  if (diff <= ALIGNED_DEG) return true;
  if (diff >= 180 - ALIGNED_DEG) return false;
  return undefined;
}

// Each pass of the route over this point (a loop can pass twice): the closest projection within
// ON_ROUTE_M, per stretch of route.
export function routePasses(line: RouteLine, lat: number, lon: number): number[] {
  const near = segmentMatches(line, lat, lon)
    .filter((m) => m.offsetM <= ON_ROUTE_M)
    .sort((a, b) => a.routeDistM - b.routeDistM);
  const passes: RouteMatch[] = [];
  for (const m of near) {
    const last = passes.at(-1);
    if (last && m.routeDistM - last.routeDistM <= SEPARATE_PASS_M) {
      if (m.offsetM < last.offsetM) passes[passes.length - 1] = m;
    } else passes.push(m);
  }
  return passes.map((p) => p.routeDistM);
}

// Feature nodes that touch the route line: the ones whose ways must be fetched.
export function nearRouteNodeIds(line: RouteLine, osmNodes: OsmNode[]): number[] {
  return osmNodes
    .filter((n) => classifyNode(n.tags) && routePasses(line, n.lat, n.lon).length > 0)
    .map((n) => n.id);
}

export function osmCandidates(line: RouteLine, osmNodes: OsmNode[], ways: OsmWay[]) {
  const candidates: Candidate[] = [];
  const warnings: string[] = [];

  for (const node of osmNodes) {
    const kind = classifyNode(node.tags);
    if (!kind) continue;
    const link = `https://www.openstreetmap.org/node/${node.id}`;
    const nodeWays = ways.filter((w) => w.nodes.includes(node.id));
    const dir = directionTag(node.tags);
    let pass = 0;

    for (const atM of routePasses(line, node.lat, node.lon)) {
      const travelDeg = routeBearingAt(line, atM);
      const along = nodeWays
        .map((w) => drivesWayForward(w, node.id, travelDeg))
        .filter((v) => v !== undefined);
      // On ways we only cross: it belongs to cross traffic.
      if (nodeWays.length > 0 && along.length === 0) continue;
      // Tagged for one direction along our road, and that is not ours.
      if (dir && along.length > 0 && !along.includes(dir === 'forward')) continue;

      if (nodeWays.length === 0)
        warnings.push(`${kind} ${link}: no way geometry, so not checked against our road`);
      else if (!dir && kind === 'stopSign')
        warnings.push(`stop sign ${link} has no direction tag: check it faces our approach`);

      pass += 1;
      candidates.push({
        id: pass === 1 ? `${kind}-${node.id}` : `${kind}-${node.id}-${pass}`,
        kind,
        lat: node.lat,
        lon: node.lon,
        source: 'osm',
        note: `OSM node ${node.id}`,
        hintM: atM,
      });
    }
  }
  return { candidates, warnings };
}

export function parseCurated(json: unknown): CuratedFile {
  if (typeof json !== 'object' || json === null) throw new Error('curated.json: not an object');
  const { remove = [], add = [] } = json as Record<string, unknown>;
  if (!Array.isArray(remove) || !remove.every((r) => typeof r === 'string'))
    throw new Error('curated.json: "remove" must be a list of feature ids');
  if (!Array.isArray(add)) throw new Error('curated.json: "add" must be a list');
  add.forEach((a: unknown, i) => {
    const f = (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>;
    const ok =
      typeof f.id === 'string' &&
      KINDS.includes(f.kind as MapFeatureKind) &&
      typeof f.lat === 'number' &&
      typeof f.lon === 'number' &&
      typeof f.note === 'string' &&
      f.note.trim() !== '' &&
      (f.street === undefined || typeof f.street === 'string') &&
      (f.nearRouteDistM === undefined || typeof f.nearRouteDistM === 'number');
    if (!ok)
      throw new Error(`curated.json: add[${i}] needs id, kind, lat, lon and a note explaining it`);
  });
  return { remove, add } as CuratedFile;
}

// Distance along the route, searched near the hint when there is one.
export function placeOnRoute(line: RouteLine, c: { lat: number; lon: number; hintM?: number }) {
  const matches =
    c.hintM === undefined
      ? segmentMatches(line, c.lat, c.lon)
      : segmentMatches(
          line,
          c.lat,
          c.lon,
          c.hintM - PLACEMENT_WINDOW_M,
          c.hintM + PLACEMENT_WINDOW_M,
        );
  return nearestMatch(matches);
}

// One feature per real-world thing: same-kind features within SAME_FEATURE_GAP_M merge into the
// first. Turns are never merged; two real turns can be close together.
export function dedupe(features: MapFeature[]): MapFeature[] {
  const lastKept = new Map<MapFeatureKind, number>();
  return features.filter((f) => {
    if (f.kind === 'turnLeft' || f.kind === 'turnRight') return true;
    const prev = lastKept.get(f.kind);
    if (prev !== undefined && f.routeDistM - prev < SAME_FEATURE_GAP_M) return false;
    lastKept.set(f.kind, f.routeDistM);
    return true;
  });
}

const round = (v: number, digits: number) => Number(v.toFixed(digits));

export function buildFixtures(input: {
  osrm: OsrmResponse;
  osmNodes: OsmNode[];
  ways: OsmWay[];
  curated: CuratedFile;
}): { route: Route; features: MapFeature[]; warnings: string[] } {
  const parsed = parseOsrm(input.osrm);
  const coordinates = parsed.coordinates.map(([lon, lat]): LonLat => [
    round(lon, 6),
    round(lat, 6),
  ]);
  const line = buildRouteLine(coordinates);
  const { candidates, warnings } = osmCandidates(line, input.osmNodes, input.ways);

  parsed.turns
    .filter((t) => !t.street)
    .forEach((t) => warnings.push(`${t.id} at ${t.lat},${t.lon} has no street name: no cue`));

  const removed = new Set(input.curated.remove);
  const known = new Set([...parsed.turns, ...candidates].map((c) => c.id));
  removed.forEach((id) => {
    if (!known.has(id)) warnings.push(`curated.json removes ${id}, which was not generated`);
  });

  const curated: Candidate[] = input.curated.add.map(({ nearRouteDistM, ...a }) => {
    const c: Candidate = { ...a, source: 'curated' };
    if (nearRouteDistM !== undefined) c.hintM = nearRouteDistM;
    return c;
  });

  const placed: MapFeature[] = [];
  for (const c of [...parsed.turns, ...candidates, ...curated]) {
    if (removed.has(c.id)) continue;
    const match = placeOnRoute(line, c);
    if (!match || match.offsetM > MAX_FEATURE_OFFSET_M) {
      const what = `${c.id} (${c.source}) is ${match ? Math.round(match.offsetM) : '?'} m from the route`;
      if (c.source === 'curated') throw new Error(`curated.json: ${what}`);
      warnings.push(`${what}: dropped`);
      continue;
    }
    const feature: MapFeature = {
      id: c.id,
      kind: c.kind,
      lat: round(c.lat, 7),
      lon: round(c.lon, 7),
      routeDistM: round(match.routeDistM, 1),
      source: c.source,
    };
    if (c.street) feature.street = c.street;
    if (c.note) feature.note = c.note;
    placed.push(feature);
  }

  const ids = new Set<string>();
  for (const f of placed) {
    if (ids.has(f.id)) throw new Error(`Duplicate feature id ${f.id}`);
    ids.add(f.id);
  }

  placed.sort((a, b) => a.routeDistM - b.routeDistM);
  const features = dedupe(placed);
  const merged = placed.length - features.length;
  if (merged > 0) warnings.push(`${merged} duplicate nearby feature(s) merged`);
  return { route: { coordinates }, features, warnings };
}

// How well the route follows the recorded drive: a route that strays from the track gives
// features the car never passes, or misses ones it does.
export function trackDeviation(route: Route, points: Array<{ lat: number; lon: number }>) {
  const line = buildRouteLine(route.coordinates);
  const offsets = points.map((p) => nearestMatch(segmentMatches(line, p.lat, p.lon))?.offsetM ?? 0);
  const far = offsets.filter((o) => o > 25).length;
  return {
    maxOffsetM: offsets.length ? Math.max(...offsets) : 0,
    farShare: offsets.length ? far / offsets.length : 0,
  };
}

// Evenly spaced points along a track (by distance), first and last included, for OSRM waypoints.
export function sampleWaypoints(points: Array<{ lat: number; lon: number }>, count: number) {
  const coords = points.map((p): LonLat => [p.lon, p.lat]);
  if (coords.length <= count || count < 2) return coords;
  const { cumM, lengthM } = buildRouteLine(coords);
  const picked: number[] = [];
  let i = 0;
  for (let k = 0; k < count; k++) {
    // Less a micrometre, so rounding in the summed distances cannot skip the exact point.
    const target = (lengthM * k) / (count - 1) - 1e-6;
    while (i < coords.length - 1 && (cumM[i] ?? 0) < target) i++;
    if (picked.at(-1) !== i) picked.push(i);
  }
  return picked.map((j) => coords[j]).filter((c): c is LonLat => c !== undefined);
}
