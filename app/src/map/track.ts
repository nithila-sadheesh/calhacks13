// Track handling shared by the map module and scripts/track: filling in speed and heading the
// GPS logger left out, and interpolating a position at any trip time.
import type { Position, TrackPoint } from '../../../shared/types.ts';
import { bearingDeg, distanceM, lerpAngleDeg } from './geo.ts';

export type MotionPoint = TrackPoint & { speedMps: number; headingDeg: number };

// Below this, the bearing between neighbouring fixes is GPS jitter, not travel direction.
const MIN_HEADING_DISTANCE_M = 2;

const isValidSpeed = (v: number | undefined): v is number => v !== undefined && v >= 0;
const isValidHeading = (v: number | undefined): v is number =>
  v !== undefined && v >= 0 && v <= 360;

// Sorted by time, duplicate times dropped, invalid values removed (iOS writes -1 for unknown
// speed, course and accuracy), and missing speed / heading derived from the neighbouring fixes.
export function withMotion(points: TrackPoint[]): MotionPoint[] {
  const sorted = points
    .filter((p) => [p.tMs, p.lat, p.lon].every(Number.isFinite))
    .sort((a, b) => a.tMs - b.tMs)
    .filter((p, i, all) => i === 0 || p.tMs !== all[i - 1]?.tMs);

  const headings: Array<number | undefined> = [];
  const speeds = sorted.map((p, i) => {
    const prev = sorted[i - 1] ?? p;
    const next = sorted[i + 1] ?? p;
    const d = distanceM(prev.lat, prev.lon, next.lat, next.lon);
    const dtS = (next.tMs - prev.tMs) / 1000;
    if (isValidHeading(p.headingDeg)) headings.push(p.headingDeg % 360);
    else if (d >= MIN_HEADING_DISTANCE_M)
      headings.push(bearingDeg(prev.lat, prev.lon, next.lat, next.lon));
    else headings.push(undefined);
    if (isValidSpeed(p.speedMps)) return p.speedMps;
    return dtS > 0 ? d / dtS : 0;
  });

  // While stopped there is no bearing: hold the last known one (or the first, at the start).
  let held = headings.find((h) => h !== undefined) ?? 0;
  return sorted.map((p, i) => {
    held = headings[i] ?? held;
    const out: MotionPoint = {
      tMs: p.tMs,
      lat: p.lat,
      lon: p.lon,
      speedMps: speeds[i] ?? 0,
      headingDeg: held,
    };
    if (p.accuracyM !== undefined && p.accuracyM >= 0) out.accuracyM = p.accuracyM;
    return out;
  });
}

// Index i with points[i].tMs <= tMs < points[i + 1].tMs, or the last index at the very end.
function bracket(points: Array<{ tMs: number }>, tMs: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((points[mid]?.tMs ?? 0) <= tMs) lo = mid;
    else hi = mid;
  }
  return (points[hi]?.tMs ?? 0) <= tMs ? hi : lo;
}

// Undefined outside the recorded span: there is no GPS fix there, and we do not dead-reckon.
export function interpolateTrack(points: MotionPoint[], tMs: number): Position | undefined {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || tMs < first.tMs || tMs > last.tMs) return undefined;
  const i = bracket(points, tMs);
  const a = points[i];
  const b = points[i + 1] ?? a;
  if (!a || !b) return undefined;
  const f = b.tMs > a.tMs ? (tMs - a.tMs) / (b.tMs - a.tMs) : 0;
  const pos: Position = {
    tripMs: tMs,
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    speedMps: a.speedMps + (b.speedMps - a.speedMps) * f,
    headingDeg: lerpAngleDeg(a.headingDeg, b.headingDeg, f),
  };
  // The worse of the two fixes: an interpolated point is no better than its weakest input.
  const accuracies = [a.accuracyM, b.accuracyM].filter((v) => v !== undefined);
  if (accuracies.length > 0) pos.accuracyM = Math.max(...accuracies);
  return pos;
}

// Distance travelled along the track up to each point.
export function odometer(points: MotionPoint[]): number[] {
  let total = 0;
  return points.map((p, i) => {
    const prev = points[i - 1];
    if (prev) total += distanceM(prev.lat, prev.lon, p.lat, p.lon);
    return total;
  });
}

export function odometerAt(points: MotionPoint[], cumM: number[], tMs: number): number {
  if (points.length === 0) return 0;
  const i = bracket(points, tMs);
  const a = points[i];
  const b = points[i + 1];
  const aM = cumM[i] ?? 0;
  if (!a || !b || tMs <= a.tMs) return aM;
  const bM = cumM[i + 1] ?? aM;
  return aM + ((bM - aM) * (tMs - a.tMs)) / (b.tMs - a.tMs);
}
