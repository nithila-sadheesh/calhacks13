// The real arbiter wired to the map, vision and voice mocks on a fake clock: the voice mock
// emits speechEnded synchronously inside `speak`, which exercises the arbiter's inbox.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import { createMockVision } from '../../../shared/mocks/vision.ts';
import { mockFactories } from '../../../shared/mocks/index.ts';
import type { ArbiterDecision, Events, ModuleContext } from '../../../shared/types.ts';
import { createArbiter } from './index.ts';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const bus = createBus();
  const clock = { ms: 0 };
  const resets = new Set<(ms: number) => void>();
  const ctx = {
    bus,
    clock: {
      nowMs: () => clock.ms,
      onReset: (cb: (ms: number) => void) => {
        resets.add(cb);
        return () => resets.delete(cb);
      },
    },
    video: { paused: true, ended: false },
  } as unknown as ModuleContext;
  const speaks: Array<Events['speak']> = [];
  const decisions: ArbiterDecision[] = [];
  bus.on('speak', (s) => speaks.push(s));
  bus.on('arbiterDecision', (d) => decisions.push(d));
  const modules = [
    mockFactories.map(),
    createMockVision({ legacy: true }),
    mockFactories.voice(),
    createArbiter(),
  ];
  // Advance trip time in 100 ms steps so every module's timer sees each moment.
  const playTo = (ms: number) => {
    while (clock.ms < ms) {
      clock.ms += 100;
      vi.advanceTimersByTime(100);
    }
  };
  const seek = (ms: number) => {
    clock.ms = ms;
    resets.forEach((cb) => cb(ms));
    bus.emit('tripReset', { tripMs: ms });
  };
  return { bus, modules, speaks, decisions, playTo, seek, ctx };
}

describe('arbiter with mocks', () => {
  it('speaks the cue, lets the alert interrupt it, drops the expired replay, resets on seek', async () => {
    const { bus, modules, speaks, decisions, playTo, seek, ctx } = setup();
    await Promise.all(modules.map((m) => m.start(ctx)));
    bus.emit('tripState', { state: 'playing' });

    playTo(10000);
    expect(speaks.map((s) => [s.id, s.priority])).toEqual([
      ['mock-cue-1#1', 1],
      ['mock-alert-1#2', 0],
    ]);
    expect(decisions.map((d) => `${d.sourceId} ${d.action}`)).toEqual([
      'mock-cue-1 spoken',
      'mock-cue-1 interrupted',
      'mock-cue-1 queued',
      'mock-alert-1 spoken',
      // The mock cue expires at 6 s, before the 2 s alert line ends.
      'mock-cue-1 dropped',
    ]);

    seek(1000);
    playTo(10000);
    expect(speaks.map((s) => s.sourceId).slice(2)).toEqual(['mock-cue-1', 'mock-alert-1']);
    expect(new Set(speaks.map((s) => s.id)).size).toBe(speaks.length);

    modules.forEach((m) => m.stop());
  });

  it('stays silent while the replay is paused', async () => {
    const { modules, speaks, playTo, ctx } = setup();
    await Promise.all(modules.map((m) => m.start(ctx)));
    playTo(4000);
    expect(speaks).toEqual([]);
    modules.forEach((m) => m.stop());
  });
});
