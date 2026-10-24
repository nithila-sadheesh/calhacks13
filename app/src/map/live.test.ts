// Live GPS: fix conversion, and the map module fed 1 Hz device fixes along the L-shaped test route.
import { describe, expect, it } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import type { Events, ModuleContext, Position } from '../../../shared/types.ts';
import { distanceM } from './geo.ts';
import { createMapModule, type FrameScheduler, type GeoSource } from './index.ts';
import { fixToPosition, type GpsFix } from './live.ts';
import { mapState } from './mapState.ts';
import { lDrive } from './testing.ts';

const fix = (over: Partial<GpsFix> = {}): GpsFix => ({
  lat: 37.87,
  lon: -122.27,
  accuracyM: 5,
  speedMps: null,
  headingDeg: null,
  ...over,
});

describe('fixToPosition', () => {
  it('uses the speed and heading the device reports', () => {
    const p = fixToPosition(fix({ speedMps: 8, headingDeg: 90 }), 1000);
    expect(p).toEqual({
      tripMs: 1000,
      lat: 37.87,
      lon: -122.27,
      speedMps: 8,
      headingDeg: 90,
      accuracyM: 5,
    });
  });

  it('derives speed and heading from the previous fix when the device reports none', () => {
    const prev: Position = { tripMs: 0, lat: 37.87, lon: -122.27, speedMps: 0, headingDeg: 0 };
    const next = fix({ lon: -122.2699, speedMps: -1, headingDeg: null });
    const p = fixToPosition(next, 1000, prev);
    expect(p.speedMps).toBeCloseTo(distanceM(37.87, -122.27, 37.87, -122.2699), 5);
    expect(p.headingDeg).toBeCloseTo(90, 0);
  });

  it('holds the last heading while standing still', () => {
    const prev: Position = { tripMs: 0, lat: 37.87, lon: -122.27, speedMps: 3, headingDeg: 45 };
    const p = fixToPosition(fix(), 1000, prev);
    expect(p.headingDeg).toBe(45);
    expect(p.speedMps).toBe(0);
  });
});

function setup() {
  const frames: FrameScheduler = { request: () => 0, cancel: () => {} };
  let requested = 0;
  frames.request = () => ++requested;
  let onFix: PositionCallback | undefined;
  let cleared: number | undefined;
  const geo: GeoSource = {
    watchPosition(success) {
      onFix = success;
      return 7;
    },
    clearWatch: (id) => (cleared = id),
  };
  let nowMs = 0;
  const bus = createBus();
  const fixtures = lDrive({ speedMps: 10 });
  const ctx: ModuleContext = {
    source: 'live',
    bus,
    clock: { nowMs: () => nowMs, onReset: () => () => {} },
    video: undefined as unknown as HTMLVideoElement,
    fixtures: { ...fixtures, track: { syncOffsetMs: 0, points: [] } },
  };
  const cues: Events['mapCue'][] = [];
  const positions: Events['position'][] = [];
  const ahead: Events['featureAhead'][] = [];
  bus.on('featureAhead', (a) => ahead.push(a));
  bus.on('mapCue', (c) => cues.push(c));
  bus.on('position', (p) => positions.push(p));
  // Replays the test drive's track as device fixes, one per second of trip time.
  const drive = () => {
    for (const p of fixtures.track.points) {
      nowMs = p.tMs;
      onFix?.({
        coords: {
          latitude: p.lat,
          longitude: p.lon,
          accuracy: 5,
          speed: null,
          heading: null,
          altitude: null,
          altitudeAccuracy: null,
        },
        timestamp: p.tMs,
      } as GeolocationPosition);
    }
  };
  return {
    ctx,
    frames,
    geo,
    cues,
    ahead,
    positions,
    drive,
    requested: () => requested,
    cleared: () => cleared,
  };
}

describe('map module, live', () => {
  it('times cues from device GPS, once per feature, without the animation-frame loop', async () => {
    const t = setup();
    const module = createMapModule(t.frames, () => t.geo);
    await module.start(t.ctx);
    t.drive();
    expect(t.requested()).toBe(0);
    expect(t.positions.length).toBeGreaterThan(50);
    expect(t.cues.map((c) => c.featureId)).toEqual(['stop-1', 'turn-1', 'crosswalk-1']);
    expect(t.cues.every((c) => c.earliestMs < c.expiresMs)).toBe(true);
    module.stop();
    expect(t.cleared()).toBe(7);
  });

  it('announces each feature once, well before its cue fires', async () => {
    const t = setup();
    const module = createMapModule(t.frames, () => t.geo);
    await module.start(t.ctx);
    t.drive();
    expect(t.ahead.map((a) => a.featureId)).toEqual(['stop-1', 'turn-1', 'crosswalk-1']);
    for (const notice of t.ahead) {
      const cue = t.cues.find((c) => c.featureId === notice.featureId)!;
      expect(cue.earliestMs - notice.tripMs).toBeGreaterThan(5000);
    }
    module.stop();
  });

  it('shows no position when the browser has no geolocation', async () => {
    const t = setup();
    const module = createMapModule(t.frames, () => undefined);
    await module.start(t.ctx);
    expect(mapState.get().status).toBe('noPosition');
    module.stop();
  });
});
