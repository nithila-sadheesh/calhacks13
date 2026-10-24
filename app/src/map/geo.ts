// Geometry shared by the map module and Jeev's fixture scripts (scripts/route, scripts/track).
// Plain functions with no browser APIs, so Node can also run them through type stripping.
export type LonLat = [lon: number, lat: number];

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial compass bearing from a to b, 0-360 degrees, 0 = north.
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLon = (bLon - aLon) * RAD;
  const y = Math.sin(dLon) * Math.cos(bLat * RAD);
  const x =
    Math.cos(aLat * RAD) * Math.sin(bLat * RAD) -
    Math.sin(aLat * RAD) * Math.cos(bLat * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

// Interpolates along the shorter arc, so 350 -> 10 passes through 0, not 180.
export function lerpAngleDeg(a: number, b: number, fraction: number): number {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + delta * fraction) % 360) + 360) % 360;
}

export type RouteLine = { coords: LonLat[]; cumM: number[]; lengthM: number };

export function buildRouteLine(coords: LonLat[]): RouteLine {
  const cumM: number[] = [];
  let total = 0;
  coords.forEach(([lon, lat], i) => {
    const prev = coords[i - 1];
    if (prev) total += distanceM(prev[1], prev[0], lat, lon);
    cumM.push(total);
  });
  return { coords, cumM, lengthM: total };
}

export type RouteMatch = { routeDistM: number; offsetM: number };

// Projection onto one segment in a local flat plane centred on its start. Accurate to well under
// a metre for segments of a few hundred metres, which is all a street route has.
function projectOnSegment(a: LonLat, b: LonLat, lat: number, lon: number) {
  const kx = Math.cos(a[1] * RAD) * EARTH_RADIUS_M * RAD;
  const ky = EARTH_RADIUS_M * RAD;
  const bx = (b[0] - a[0]) * kx;
  const by = (b[1] - a[1]) * ky;
  const px = (lon - a[0]) * kx;
  const py = (lat - a[1]) * ky;
  const len2 = bx * bx + by * by;
  const fraction = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
  return { fraction, offsetM: Math.hypot(px - fraction * bx, py - fraction * by) };
}

// The projection onto every segment that overlaps [fromM, toM] along the route.
export function segmentMatches(
  line: RouteLine,
  lat: number,
  lon: number,
  fromM = -Infinity,
  toM = Infinity,
): RouteMatch[] {
  const out: RouteMatch[] = [];
  for (let i = 0; i + 1 < line.coords.length; i++) {
    const a = line.coords[i];
    const b = line.coords[i + 1];
    const startM = line.cumM[i];
    const endM = line.cumM[i + 1];
    if (!a || !b || startM === undefined || endM === undefined) continue;
    if (endM < fromM || startM > toM) continue;
    const { fraction, offsetM } = projectOnSegment(a, b, lat, lon);
    out.push({ routeDistM: startM + fraction * (endM - startM), offsetM });
  }
  return out;
}

export function nearestMatch(matches: RouteMatch[]): RouteMatch | undefined {
  let best: RouteMatch | undefined;
  for (const m of matches) if (!best || m.offsetM < best.offsetM) best = m;
  return best;
}

// Of every projection within toleranceM of the closest one, the one nearest priorM along the
// route. A route that uses the same street twice (a loop) has two good projections there; the
// prior picks the pass we are on.
export function matchRoute(
  line: RouteLine,
  lat: number,
  lon: number,
  priorM: number,
  toleranceM: number,
): RouteMatch | undefined {
  const matches = segmentMatches(line, lat, lon);
  const best = nearestMatch(matches);
  if (!best) return undefined;
  let chosen = best;
  for (const m of matches) {
    if (m.offsetM > best.offsetM + toleranceM) continue;
    if (Math.abs(m.routeDistM - priorM) < Math.abs(chosen.routeDistM - priorM)) chosen = m;
  }
  return chosen;
}

export function pointAtDistance(line: RouteLine, distM: number): { lat: number; lon: number } {
  const { coords, cumM } = line;
  const first = coords[0];
  if (!first) return { lat: 0, lon: 0 };
  for (let i = 0; i + 1 < coords.length; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const startM = cumM[i];
    const endM = cumM[i + 1];
    if (!a || !b || startM === undefined || endM === undefined) continue;
    if (distM <= endM || i + 2 === coords.length) {
      const f = endM > startM ? Math.min(1, Math.max(0, (distM - startM) / (endM - startM))) : 0;
      return { lat: a[1] + (b[1] - a[1]) * f, lon: a[0] + (b[0] - a[0]) * f };
    }
  }
  return { lat: first[1], lon: first[0] };
}
