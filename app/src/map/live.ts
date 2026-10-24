// Live GPS for live trips: turns each browser geolocation fix into a `Position` stamped with trip
// time. Speed and heading come from the fix when the device reports them (iOS reports null or -1
// while it cannot tell), otherwise from the previous fix, the same way withMotion fills a GPX.
import type { Position } from '../../../shared/types.ts';
import { bearingDeg, distanceM } from './geo.ts';

export type GpsFix = {
  lat: number;
  lon: number;
  accuracyM: number;
  speedMps: number | null;
  headingDeg: number | null;
};

// Below this, the bearing between fixes is GPS jitter, not travel direction.
const MIN_HEADING_DISTANCE_M = 2;
// Fixes closer together than this give a meaningless derived speed.
const MIN_SPEED_INTERVAL_MS = 200;

const valid = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;

export function fixToPosition(fix: GpsFix, tripMs: number, prev?: Position): Position {
  const movedM = prev ? distanceM(prev.lat, prev.lon, fix.lat, fix.lon) : 0;
  const dtMs = prev ? tripMs - prev.tripMs : 0;

  let speedMps = prev?.speedMps ?? 0;
  if (valid(fix.speedMps)) speedMps = fix.speedMps;
  else if (dtMs >= MIN_SPEED_INTERVAL_MS) speedMps = movedM / (dtMs / 1000);

  let headingDeg = prev?.headingDeg ?? 0;
  if (valid(fix.headingDeg) && fix.headingDeg <= 360) headingDeg = fix.headingDeg % 360;
  else if (prev && movedM >= MIN_HEADING_DISTANCE_M)
    headingDeg = bearingDeg(prev.lat, prev.lon, fix.lat, fix.lon);

  return { tripMs, lat: fix.lat, lon: fix.lon, speedMps, headingDeg, accuracyM: fix.accuracyM };
}

export function toGpsFix({ coords }: GeolocationPosition): GpsFix {
  return {
    lat: coords.latitude,
    lon: coords.longitude,
    accuracyM: coords.accuracy,
    speedMps: coords.speed,
    headingDeg: coords.heading,
  };
}
