import { afterEach, expect, it, vi } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import type { ModuleContext, VisionAdvice } from '../../../shared/types.ts';
import type { CoachingResponse } from '../../../shared/coaching.ts';
import { createVisionModule } from './index.ts';
import { coachingStore } from './coachingStore.ts';
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
const response: CoachingResponse = {
  shouldSpeak: true,
  message: 'Watch for cyclists near parked cars.',
  reason: 'A cyclist is visible.',
};
function setup() {
  vi.useFakeTimers();
  let tripMs = 0;
  const bus = createBus();
  const video = { paused: false, ended: false } as HTMLVideoElement;
  const ctx: ModuleContext = {
    bus,
    video,
    clock: { nowMs: () => tripMs, onReset: () => () => {} },
    fixtures: { track: { points: [], syncOffsetMs: 0 }, features: [], route: { coordinates: [] } },
  };
  const analyze = vi.fn().mockResolvedValue(response);
  const module = createVisionModule({
    capture: (_video, ms) => ({ tripMs: ms, jpeg: '/9j/AA==' }),
    analyze,
  });
  const advice: VisionAdvice[] = [];
  bus.on('visionAdvice', (value) => advice.push(value));
  const advance = async (ms: number) => {
    for (let i = 0; i < ms; i += 100) {
      tripMs += 100;
      await vi.advanceTimersByTimeAsync(100);
    }
  };
  return { module, ctx, bus, analyze, advice, advance };
}
it('batches recent frames, suppresses repeated advice, and emits upload metadata', async () => {
  const s = setup();
  const sent = vi.fn();
  s.bus.on('dataSent', sent);
  try {
    await s.module.start(s.ctx);
    await s.advance(1200);
    expect(s.analyze).toHaveBeenCalledTimes(1);
    expect(s.analyze.mock.calls[0]![0].frames).toHaveLength(2);
    expect(s.advice).toHaveLength(1);
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ destination: 'anthropic-vision' }));
    await s.advance(6000);
    expect(s.advice).toHaveLength(1);
  } finally {
    s.module.stop();
  }
});
it('keeps one request in flight and discards results after pause, seek or stop', async () => {
  for (const cancel of ['pause', 'seek', 'stop']) {
    const s = setup();
    let resolve!: (value: CoachingResponse) => void;
    s.analyze.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await s.module.start(s.ctx);
    await s.advance(6000);
    expect(s.analyze).toHaveBeenCalledTimes(1);
    const signal = s.analyze.mock.calls[0]![1] as AbortSignal;
    if (cancel === 'pause') s.bus.emit('tripState', { state: 'paused' });
    if (cancel === 'seek') s.bus.emit('tripReset', { tripMs: 0 });
    if (cancel === 'stop') s.module.stop();
    expect(signal.aborted).toBe(true);
    resolve(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.advice).toEqual([]);
    s.module.stop();
  }
});
it('drops stale analysis and recovers from a request failure without inventing speech', async () => {
  const s = setup();
  let resolve!: (value: CoachingResponse) => void;
  s.analyze.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  try {
    await s.module.start(s.ctx);
    await s.advance(10_000);
    resolve(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.advice).toEqual([]);
    s.analyze.mockRejectedValueOnce(new Error('offline'));
    await s.advance(1000);
    expect(coachingStore.get().status).toBe('error');
    expect(s.advice).toEqual([]);
  } finally {
    s.module.stop();
  }
});

it('passes timestamped observations to the next analysis and clears them on seek', async () => {
  const s = setup();
  s.analyze.mockResolvedValue({
    ...response,
    observations: ['A car is already waiting.'],
    uncertainties: ['Arrival order was not observed.'],
    coachingPoint: 'Preserve uncertainty.',
    sceneChanged: false,
  });
  try {
    await s.module.start(s.ctx);
    await s.advance(4500);
    const second = s.analyze.mock.calls[1]![0];
    expect(second.sceneMemory[0].uncertainties).toEqual(['Arrival order was not observed.']);
    expect(second.frames).toHaveLength(3);
    s.bus.emit('tripReset', { tripMs: 4500 });
    const count = s.analyze.mock.calls.length;
    await s.advance(1200);
    expect(s.analyze.mock.calls[count]![0].sceneMemory).toEqual([]);
  } finally {
    s.module.stop();
  }
});

it('starts the opening analysis after two closely spaced frames', async () => {
  const s = setup();
  try {
    await s.module.start(s.ctx);
    await s.advance(500);
    expect(s.analyze).toHaveBeenCalledTimes(1);
    const frames = s.analyze.mock.calls[0]![0].frames as Array<{ tripMs: number }>;
    expect(frames).toHaveLength(2);
    expect(frames[1]!.tripMs - frames[0]!.tripMs).toBeGreaterThanOrEqual(250);
    expect(frames[1]!.tripMs).toBeLessThan(1000);
  } finally {
    s.module.stop();
  }
});
