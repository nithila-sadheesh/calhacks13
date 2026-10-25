import { afterEach, expect, it, vi } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import type { Events, ModuleContext } from '../../../shared/types.ts';
import { createVisionModule } from './localRuntime.ts';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./detector.ts', () => ({ loadDetector: mocks.load }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function setup() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 125));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  const bus = createBus();
  const resets = new Set<() => void>();
  const video = { currentTime: 0, paused: false, ended: false, readyState: 4, videoWidth: 1280 };
  const health: Events['cameraHealth'][] = [];
  bus.on('cameraHealth', (event) => health.push(event));
  const ctx: ModuleContext = {
    source: 'replay',
    bus,
    video: video as HTMLVideoElement,
    clock: {
      nowMs: () => video.currentTime * 1000,
      onReset(cb) {
        const reset = () => cb(0);
        resets.add(reset);
        return () => {
          resets.delete(reset);
        };
      },
    },
    fixtures: { track: { points: [], syncOffsetMs: 0 }, features: [], route: { coordinates: [] } },
  };
  return { ctx, video, resets, health };
}
it('does not turn a frozen video frame into repeated detections and reports recovery', async () => {
  const s = setup();
  const detect = vi.fn(() => []);
  const close = vi.fn();
  mocks.load.mockResolvedValue({ detect, close });
  const module = createVisionModule();
  try {
    await module.start(s.ctx);
    await vi.advanceTimersByTimeAsync(3000);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(s.health.at(-1)?.ok).toBe(false);
    s.video.currentTime = 3;
    await vi.advanceTimersByTimeAsync(500);
    expect(s.health.at(-1)?.ok).toBe(true);
    s.resets.forEach((reset) => reset());
    await vi.advanceTimersByTimeAsync(125);
    expect(detect).toHaveBeenCalledTimes(3);
    await module.start(s.ctx);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    module.stop();
  }
  expect(s.resets.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('discards a detector that finishes loading after stop', async () => {
  const s = setup();
  let resolve!: (value: { detect: () => []; close: () => void }) => void;
  mocks.load.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const module = createVisionModule();
  const starting = module.start(s.ctx);
  module.stop();
  const close = vi.fn();
  resolve({ detect: () => [], close });
  await starting;
  expect(close).toHaveBeenCalledTimes(1);
  expect(s.health).toEqual([]);
  expect(s.resets.size).toBe(0);
});
