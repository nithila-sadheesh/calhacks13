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
function setup(periodicReminders = false) {
  vi.useFakeTimers();
  let ms = 0;
  let x = 0.1;
  const bus = createBus();
  const video = { paused: false, ended: false, readyState: 4, videoWidth: 1280 };
  const ctx: ModuleContext = {
    source: 'replay',
    bus,
    video: video as HTMLVideoElement,
    clock: { nowMs: () => ms, onReset: () => () => {} },
    fixtures: { track: { points: [], syncOffsetMs: 0 }, features: [], route: { coordinates: [] } },
  };
  const detect = vi.fn(() => [
    { cls: 'car' as const, score: 0.9, box: { x, y: 0.4, w: 0.2, h: 0.2 } },
  ]);
  const close = vi.fn();
  const loadDetector = vi.fn().mockResolvedValue({ detect, close });
  const analyze = vi.fn().mockResolvedValue({
    shouldSpeak: true,
    message: 'Keep the car on your left in view.',
    reason: 'A car is detected in the left image region.',
    observations: ['Car in the left image region.'],
    uncertainties: ['Distance and intention are unknown.'],
    coachingPoint: 'Monitor that road user.',
    sceneChanged: false,
  });
  const module = createVisionModule({ loadDetector, analyze, periodicReminders });
  const advice: VisionAdvice[] = [];
  bus.on('visionAdvice', (value) => advice.push(value));
  const advance = async (duration: number) => {
    for (let i = 0; i < duration; i += 100) {
      ms += 100;
      await vi.advanceTimersByTimeAsync(100);
    }
  };
  return {
    ctx,
    video,
    bus,
    detect,
    close,
    loadDetector,
    analyze,
    module,
    advice,
    advance,
    move: () => {
      x = 0.7;
    },
  };
}
it('runs local CV continuously but sends image-free JSON only for stable scene changes', async () => {
  const s = setup();
  const sent = vi.fn();
  s.bus.on('dataSent', sent);
  try {
    await s.module.start(s.ctx);
    await s.advance(5000);
    expect(s.detect.mock.calls.length).toBeGreaterThan(20);
    expect(s.analyze).toHaveBeenCalledTimes(1);
    expect(s.analyze.mock.calls[0]![0].frames).toBeUndefined();
    expect(s.analyze.mock.calls[0]![0].scene.objects[0]).toMatchObject({
      class: 'car',
      imageSide: 'left',
    });
    expect(sent).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.stringContaining('no images') }),
    );
    s.move();
    await s.advance(2200);
    expect(s.analyze).toHaveBeenCalledTimes(2);
    expect(s.advice).toHaveLength(1);
    expect(coachingStore.get().cvFrames).toBeGreaterThan(30);
  } finally {
    s.module.stop();
  }
  expect(s.close).toHaveBeenCalledTimes(1);
});
it('keeps detecting while Claude is pending and discards output after reset', async () => {
  const s = setup();
  let resolve!: (value: CoachingResponse) => void;
  s.analyze.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  try {
    await s.module.start(s.ctx);
    await s.advance(5000);
    expect(s.analyze).toHaveBeenCalledTimes(1);
    expect(s.detect.mock.calls.length).toBeGreaterThan(20);
    const signal = s.analyze.mock.calls[0]![1] as AbortSignal;
    s.bus.emit('tripReset', { tripMs: 0 });
    expect(signal.aborted).toBe(true);
    resolve({
      shouldSpeak: true,
      message: 'Keep the car on your left in view.',
      reason: 'Old scene.',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.advice).toEqual([]);
  } finally {
    s.module.stop();
  }
});
it('closes a detector that finishes loading after stop', async () => {
  const s = setup();
  let resolve!: (value: { detect: typeof s.detect; close: typeof s.close }) => void;
  s.loadDetector.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const pending = s.module.start(s.ctx);
  s.module.stop();
  resolve({ detect: s.detect, close: s.close });
  await pending;
  expect(s.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('allows Claude to choose silence without fabricating a spoken alert', async () => {
  const s = setup();
  s.analyze.mockResolvedValue({
    shouldSpeak: false,
    message: '',
    reason: 'No new useful interaction.',
    observations: ['Car on the left.'],
    uncertainties: ['Intent is unknown.'],
    coachingPoint: 'No new cue needed.',
    sceneChanged: false,
  });
  try {
    await s.module.start(s.ctx);
    await s.advance(2500);
    expect(s.analyze).toHaveBeenCalledTimes(1);
    expect(s.advice).toEqual([]);
    expect(coachingStore.get().message).toBeUndefined();
    expect(coachingStore.get().diagnostics?.[0]).toMatchObject({
      outcome: 'Claude chose silence',
      response: { reason: 'No new useful interaction.' },
    });
    expect(coachingStore.get().cvFrames).toBeGreaterThan(5);
  } finally {
    s.module.stop();
  }
});

it('fills only real silences with local reminders, without repeating or keeping a beat', async () => {
  const s = setup(true);
  s.analyze.mockResolvedValue({ shouldSpeak: false, message: '', reason: 'No stronger cue.' });
  try {
    await s.module.start(s.ctx);
    await s.advance(11500);
    expect(s.advice).toHaveLength(0);
    await s.advance(1000);
    expect(s.advice).toHaveLength(1);
    expect(s.advice[0]?.text).toContain('car on your left');
    expect(s.advice[0]?.delivery?.emotion).toBe('confident');
    // The same reminder is not said again while the scene stays the same.
    await s.advance(30000);
    expect(s.advice).toHaveLength(1);
    s.move();
    s.bus.emit('speak', {
      id: 'busy',
      text: 'Keep observing.',
      priority: 1,
      sourceId: 'test',
      origin: 'vision',
    });
    await s.advance(25000);
    expect(s.advice).toHaveLength(1);
    // The next gap is longer than the first and counts from the end of the last line.
    s.bus.emit('speechEnded', { id: 'busy', interrupted: false });
    await s.advance(15000);
    expect(s.advice).toHaveLength(1);
    await s.advance(1500);
    expect(s.advice).toHaveLength(2);
    expect(s.advice[1]?.text).toContain('car on your right');
  } finally {
    s.module.stop();
  }
});

it("forwards Claude's delivery, reports quiet time and holds lines that follow speech too closely", async () => {
  const s = setup();
  const delivery = { emotion: 'determined', pace: 'normal', speed: 1.1, volume: 1.15 } as const;
  s.analyze.mockResolvedValueOnce({
    shouldSpeak: true,
    message: 'Keep the car on your left in view.',
    reason: 'A car is detected in the left image region.',
    delivery,
  });
  try {
    await s.module.start(s.ctx);
    await s.advance(1500);
    expect(s.advice).toHaveLength(1);
    expect(s.advice[0]?.delivery).toEqual(delivery);
    const firstRequest = s.analyze.mock.calls[0]![0] as { quietForMs?: number };
    expect(firstRequest.quietForMs).toBeGreaterThanOrEqual(0);
    s.bus.emit('speak', {
      id: 'line',
      text: 'Keep the car on your left in view.',
      priority: 1,
      sourceId: 'test',
      origin: 'vision',
    });
    s.bus.emit('speechEnded', { id: 'line', interrupted: false });
    s.analyze.mockResolvedValueOnce({
      shouldSpeak: true,
      message: 'Track the car now on your right.',
      reason: 'The car moved to the right image region.',
    });
    s.move();
    await s.advance(3500);
    expect(s.analyze).toHaveBeenCalledTimes(2);
    expect(s.advice).toHaveLength(1);
    expect(coachingStore.get().diagnostics?.at(-1)?.outcome).toBe(
      'Suppressed: too soon after the previous line',
    );
  } finally {
    s.module.stop();
  }
});

it('waits for a live trip to start and stops observations when it ends', async () => {
  const s = setup();
  s.ctx.source = 'live';
  const scenes = vi.fn();
  s.bus.on('visionScene', scenes);
  try {
    await s.module.start(s.ctx);
    await s.advance(1000);
    expect(s.detect).not.toHaveBeenCalled();
    s.bus.emit('tripState', { state: 'playing' });
    await s.advance(1000);
    expect(scenes).toHaveBeenCalled();
    s.bus.emit('tripState', { state: 'ended' });
    const count = s.detect.mock.calls.length;
    await s.advance(1000);
    expect(s.detect).toHaveBeenCalledTimes(count);
  } finally {
    s.module.stop();
  }
});
