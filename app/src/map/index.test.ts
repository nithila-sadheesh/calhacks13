// The map module wired to a real bus, a fake clock and hand-stepped animation frames.
import { describe, expect, it } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import type { EventName, Events, ModuleContext } from '../../../shared/types.ts';
import { EMPTY_SNAPSHOT } from './engine.ts';
import { createMapModule, type FrameScheduler } from './index.ts';
import { mapState } from './mapState.ts';
import { lDrive } from './testing.ts';

function setup() {
  const pending = new Map<number, () => void>();
  let nextId = 1;
  const frames: FrameScheduler = {
    request(cb) {
      pending.set(nextId, cb);
      return nextId++;
    },
    cancel: (id) => pending.delete(id),
  };
  const flush = () => {
    const cbs = [...pending.values()];
    pending.clear();
    cbs.forEach((cb) => cb());
  };

  let nowMs = 0;
  const resets = new Set<(ms: number) => void>();
  const bus = createBus();
  const ctx = {
    bus,
    clock: {
      nowMs: () => nowMs,
      onReset(cb: (ms: number) => void) {
        resets.add(cb);
        return () => resets.delete(cb);
      },
    },
    video: undefined as unknown as HTMLVideoElement,
    fixtures: lDrive({ speedMps: 10 }),
  } satisfies ModuleContext;

  const seen: Array<[EventName, unknown]> = [];
  bus.onAny((type, payload) => seen.push([type, payload]));
  const of = <K extends EventName>(type: K) =>
    seen.filter(([t]) => t === type).map(([, p]) => p as Events[K]);

  const playTo = (toMs: number, stepMs = 100) => {
    for (; nowMs < toMs;) {
      nowMs = Math.min(toMs, nowMs + stepMs);
      flush();
    }
  };
  const seek = (ms: number) => {
    nowMs = ms;
    resets.forEach((cb) => cb(ms));
    bus.emit('tripReset', { tripMs: ms });
  };

  return { ctx, frames, flush, pending, resets, of, playTo, seek };
}

describe('map module', () => {
  it('emits nothing inside start(); the first frame emits a position but no cue', async () => {
    const t = setup();
    const module = createMapModule(t.frames);
    await module.start(t.ctx);
    expect(t.of('position')).toHaveLength(0);
    t.flush();
    expect(t.of('position')).toHaveLength(1);
    expect(t.of('mapCue')).toHaveLength(0);
    expect(mapState.get().status).toBe('ok');
    module.stop();
  });

  it('emits positions at about 10 Hz of trip time and none while paused', async () => {
    const t = setup();
    const module = createMapModule(t.frames);
    await module.start(t.ctx);
    t.flush();
    t.playTo(1000, 16);
    expect(t.of('position').length).toBeGreaterThanOrEqual(9);
    expect(t.of('position').length).toBeLessThanOrEqual(11);
    const before = t.of('position').length;
    for (let i = 0; i < 30; i++) t.flush();
    expect(t.of('position')).toHaveLength(before);
    module.stop();
  });

  it('emits each cue once and again after a seek back, never during the reset', async () => {
    const t = setup();
    const module = createMapModule(t.frames);
    await module.start(t.ctx);
    t.flush();
    t.playTo(60_000);
    expect(t.of('mapCue').map((c) => c.featureId)).toEqual(['stop-1', 'turn-1', 'crosswalk-1']);

    t.seek(0);
    expect(mapState.get()).toBe(EMPTY_SNAPSHOT);
    expect(t.of('mapCue')).toHaveLength(3);
    t.flush();
    t.playTo(60_000);
    expect(t.of('mapCue').map((c) => c.featureId)).toEqual([
      'stop-1',
      'turn-1',
      'crosswalk-1',
      'stop-1',
      'turn-1',
      'crosswalk-1',
    ]);
    const ids = t.of('mapCue').map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    module.stop();
  });

  it('stops cleanly: no frame pending, reset listener removed, panel state cleared', async () => {
    const t = setup();
    const module = createMapModule(t.frames);
    await module.start(t.ctx);
    t.flush();
    module.stop();
    expect(t.pending.size).toBe(0);
    expect(t.resets.size).toBe(0);
    expect(mapState.get()).toBe(EMPTY_SNAPSHOT);
    module.stop();
  });

  it('restarts without leaking a second loop', async () => {
    const t = setup();
    const module = createMapModule(t.frames);
    await module.start(t.ctx);
    await module.start(t.ctx);
    expect(t.pending.size).toBe(1);
    expect(t.resets.size).toBe(1);
    module.stop();
  });
});
