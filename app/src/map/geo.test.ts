import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  buildRouteLine,
  distanceM,
  lerpAngleDeg,
  matchRoute,
  pointAtDistance,
  segmentMatches,
} from './geo.ts';
import { L_ROUTE, offsetM } from './testing.ts';

describe('geo', () => {
  it('measures distance and bearing', () => {
    const [lonA, latA] = offsetM(0, 0);
    const [lonB, latB] = offsetM(100, 0);
    expect(distanceM(latA, lonA, latB, lonB)).toBeCloseTo(100, 0);
    expect(bearingDeg(latA, lonA, latB, lonB)).toBeCloseTo(90, 0);
    expect(bearingDeg(latB, lonB, latA, lonA)).toBeCloseTo(270, 0);
  });

  it('interpolates angles along the shorter arc', () => {
    expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(lerpAngleDeg(10, 350, 0.25)).toBeCloseTo(5, 6);
    expect(lerpAngleDeg(90, 180, 0.5)).toBeCloseTo(135, 6);
  });

  it('builds cumulative distances and finds points along the route', () => {
    const line = buildRouteLine(L_ROUTE);
    expect(line.lengthM).toBeCloseTo(600, 0);
    const p = pointAtDistance(line, 450);
    const [lon, lat] = offsetM(300, 150);
    expect(distanceM(p.lat, p.lon, lat, lon)).toBeLessThan(0.5);
  });

  it('projects a point beside the route with its offset', () => {
    const line = buildRouteLine(L_ROUTE);
    const [lon, lat] = offsetM(120, 8);
    const best = matchRoute(line, lat, lon, 0, 15);
    expect(best?.routeDistM).toBeCloseTo(120, 0);
    expect(best?.offsetM).toBeCloseTo(8, 0);
  });

  it('uses the prior to pick between two passes of the same street', () => {
    // Out 200 m east and back the same way: every point on it has two equally good matches.
    const line = buildRouteLine([offsetM(0, 0), offsetM(200, 0), offsetM(0, 0)]);
    const [lon, lat] = offsetM(50, 1);
    expect(matchRoute(line, lat, lon, 0, 15)?.routeDistM).toBeCloseTo(50, 0);
    expect(matchRoute(line, lat, lon, 360, 15)?.routeDistM).toBeCloseTo(350, 0);
  });

  it('limits segment matches to a distance window', () => {
    const line = buildRouteLine(L_ROUTE);
    const [lon, lat] = offsetM(300, 100);
    expect(segmentMatches(line, lat, lon, 350, 600)).toHaveLength(1);
    expect(segmentMatches(line, lat, lon)).toHaveLength(2);
  });
});
