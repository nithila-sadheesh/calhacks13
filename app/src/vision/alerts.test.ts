import { describe, expect, it } from 'vitest';
import { ALERT_TTL_MS, COOLDOWN_MS, PED_FRAMES_WINDOW } from './config.ts';
import { createAlertEngine } from './alerts.ts';
import type { Track } from './tracker.ts';

// A person box whose bottom-center sits inside the forward region (lower-center of the frame).
const personInRegion = (score: number, id = 1): Track => ({
  id,
  cls: 'person',
  score,
  box: { x: 0.45, y: 0.6, w: 0.1, h: 0.35 },
});

// A person box off to the far left, outside the region.
const personOutsideRegion = (score: number, id = 1): Track => ({
  id,
  cls: 'person',
  score,
  box: { x: 0.0, y: 0.6, w: 0.08, h: 0.35 },
});

// Drive the engine through n identical frames spaced one detection apart.
function run(
  engine: ReturnType<typeof createAlertEngine>,
  track: Track,
  frames: number,
  startMs = 0,
) {
  let last = null as ReturnType<typeof engine.update>;
  for (let i = 0; i < frames; i += 1) {
    last = engine.update({ tracks: [track], tripMs: startMs + i * 125, speedMps: 9 });
  }
  return last;
}

describe('pedestrianNearby', () => {
  it('does not fire before 4 of the last 5 frames qualify', () => {
    const engine = createAlertEngine();
    const result = run(engine, personInRegion(0.8), PED_FRAMES_WINDOW - 1);
    expect(result).toBeNull();
  });

  it('fires once the window is full with enough qualifying frames', () => {
    const engine = createAlertEngine();
    const result = run(engine, personInRegion(0.8), PED_FRAMES_WINDOW);
    expect(result).not.toBeNull();
    expect(result?.alert.kind).toBe('pedestrianNearby');
    expect(result?.alert.text).toBe('Pedestrian ahead. Stay alert.');
    expect(result?.alert.clipKey).toBe('pedestrianNearby');
    expect(result?.trackId).toBe(1);
  });

  it('sets expiresMs to detection time plus the TTL', () => {
    const engine = createAlertEngine();
    let fired = null as ReturnType<typeof engine.update>;
    let t = 0;
    for (let i = 0; i < PED_FRAMES_WINDOW; i += 1) {
      t = i * 125;
      fired = engine.update({ tracks: [personInRegion(0.8)], tripMs: t, speedMps: 9 });
    }
    expect(fired?.alert.expiresMs).toBe(t + ALERT_TTL_MS);
  });

  it('does not fire for a confident person outside the forward region', () => {
    const engine = createAlertEngine();
    const result = run(engine, personOutsideRegion(0.9), PED_FRAMES_WINDOW + 2);
    expect(result).toBeNull();
  });

  it('does not fire below the 0.6 confidence floor', () => {
    const engine = createAlertEngine();
    const result = run(engine, personInRegion(0.5), PED_FRAMES_WINDOW + 2);
    expect(result).toBeNull();
  });

  it('respects the per-kind cooldown, then fires again after it elapses', () => {
    const engine = createAlertEngine();
    const first = run(engine, personInRegion(0.8), PED_FRAMES_WINDOW);
    expect(first).not.toBeNull();
    const firstMs = first?.alert.tripMs ?? 0;

    // Keep qualifying but inside the cooldown window: no second alert.
    const during = engine.update({
      tracks: [personInRegion(0.8)],
      tripMs: firstMs + COOLDOWN_MS - 1,
      speedMps: 9,
    });
    expect(during).toBeNull();

    // Past the cooldown: fires again.
    const after = engine.update({
      tracks: [personInRegion(0.8)],
      tripMs: firstMs + COOLDOWN_MS + 125,
      speedMps: 9,
    });
    expect(after).not.toBeNull();
  });

  it('reset clears history so the window must refill', () => {
    const engine = createAlertEngine();
    run(engine, personInRegion(0.8), PED_FRAMES_WINDOW - 1);
    engine.reset();
    const immediatelyAfter = engine.update({
      tracks: [personInRegion(0.8)],
      tripMs: 10_000,
      speedMps: 9,
    });
    expect(immediatelyAfter).toBeNull();
  });
});

describe('followingDistance fallback', () => {
  const closeVehicle = (id = 2): Track => ({
    id,
    cls: 'car',
    score: 0.9,
    box: { x: 0.3, y: 0.55, w: 0.45, h: 0.4 },
  });

  it('stays silent when disabled (the default)', () => {
    const engine = createAlertEngine({ enableFollowingDistance: false });
    let last = null as ReturnType<typeof engine.update>;
    for (let i = 0; i < 40; i += 1) {
      last = engine.update({ tracks: [closeVehicle()], tripMs: i * 125, speedMps: 9 });
    }
    expect(last).toBeNull();
  });

  it('fires after a wide vehicle is held for the sustain time while moving', () => {
    const engine = createAlertEngine({ enableFollowingDistance: true });
    let fired = null as ReturnType<typeof engine.update>;
    for (let i = 0; i < 40 && !fired; i += 1) {
      fired = engine.update({ tracks: [closeVehicle()], tripMs: i * 125, speedMps: 9 });
    }
    expect(fired?.alert.kind).toBe('followingDistance');
    expect(fired?.alert.text).toBe('Leave more space ahead.');
    expect(fired?.alert.clipKey).toBe('followingDistance');
  });

  it('does not fire when speed is at or below the threshold', () => {
    const engine = createAlertEngine({ enableFollowingDistance: true });
    let last = null as ReturnType<typeof engine.update>;
    for (let i = 0; i < 40; i += 1) {
      last = engine.update({ tracks: [closeVehicle()], tripMs: i * 125, speedMps: 3 });
    }
    expect(last).toBeNull();
  });
});
