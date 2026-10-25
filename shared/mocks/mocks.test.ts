// Runs all four mocks together on a fake clock: a map cue and a vision alert must reach the
// voice mock as speak requests, and the vision alert (priority 0) must interrupt the cue.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBus } from '../bus.ts';
import type { EventName, Events, ModuleContext } from '../types.ts';
import { createMockVision } from './vision.ts';
import { mockFactories } from './index.ts';

afterEach(() => vi.useRealTimers());

describe('mock modules', () => {
  it('cue, then alert interrupting it, then reset', async () => {
    vi.useFakeTimers();
    const bus = createBus();
    let nowMs = 0;
    const resets: Array<(ms: number) => void> = [];
    const ctx = {
      bus,
      clock: {
        nowMs: () => nowMs,
        onReset: (cb: (ms: number) => void) => {
          resets.push(cb);
          return () => undefined;
        },
      },
    } as unknown as ModuleContext;

    const seen: Array<[EventName, unknown]> = [];
    bus.onAny((type, payload) => seen.push([type, payload]));
    const all = Object.entries(mockFactories).map(([name, make]) =>
      name === 'vision' ? createMockVision({ legacy: true }) : make(),
    );
    await Promise.all(all.map((m) => m.start(ctx)));

    nowMs = 3100;
    vi.advanceTimersByTime(200);
    nowMs = 5100;
    vi.advanceTimersByTime(200);

    const speaks = seen.filter(([t]) => t === 'speak').map(([, p]) => p as Events['speak']);
    expect(speaks.map((s) => s.priority)).toEqual([1, 0]);
    const ended = seen
      .filter(([t]) => t === 'speechEnded')
      .map(([, p]) => p as Events['speechEnded']);
    expect(ended).toEqual([{ id: 'speak-mock-cue-1', interrupted: true }]);

    all.forEach((m) => m.stop());
  });
});
