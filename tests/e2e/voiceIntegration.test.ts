import { afterEach, expect, it, vi } from 'vitest';
import { createBus } from '../../shared/bus.ts';
import { createVisionModule } from '../../app/src/vision/index.ts';
import { createMapModule } from '../../app/src/map/index.ts';
import { feature, lDrive } from '../../app/src/map/testing.ts';
import { createMockMap } from '../../shared/mocks/map.ts';
import { createMockVision } from '../../shared/mocks/vision.ts';
import type { Events, ModuleContext } from '../../shared/types.ts';
import { createArbiter } from '../../app/src/arbiter/index.ts';
import { createVoiceModule } from '../../app/src/voice/index.ts';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  player: vi.fn(),
  transport: vi.fn(),
  detector: vi.fn(),
}));
vi.mock('../../app/src/vision/detector.ts', () => ({ loadDetector: mocks.detector }));
vi.mock('../../app/src/voice/clips.ts', () => ({ loadClips: mocks.load }));
vi.mock('../../app/src/voice/player.ts', () => ({ createAudioPlayer: mocks.player }));
vi.mock('../../app/src/voice/sonic.ts', () => ({ createSonicTransport: mocks.transport }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each(['mock', 'real', 'all-real'] as const)(
  'connects %s map to real arbiter and voice through interruption, repeat, pause and seek reset',
  async (mapMode) => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
    });
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 125));
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    let ms = 0;
    const bus = createBus();
    const resets = new Set<(ms: number) => void>();
    const ctx: ModuleContext = {
      source: 'replay',
      bus,
      clock: {
        nowMs: () => ms,
        onReset: (cb) => {
          resets.add(cb);
          return () => {
            resets.delete(cb);
          };
        },
      },
      video: {
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 1280,
        get currentTime() {
          return ms / 1000;
        },
      } as HTMLVideoElement,
      fixtures: { ...lDrive(), features: [feature('stop-integration', 'stopSign', 120)] },
    };
    const samples = new Float32Array([0.2]);
    mocks.load.mockResolvedValue(
      new Map([
        ['pedestrianNearby', samples],
        ['stopSign', samples],
      ]),
    );
    const nodes: Array<{ stop: ReturnType<typeof vi.fn>; start: () => void; end: () => void }> = [];
    mocks.player.mockReturnValue({
      ready: () => true,
      enable: async () => {},
      close: vi.fn(),
      play: vi.fn((_samples, start: () => void, end: () => void) => {
        const node = { stop: vi.fn(), start, end };
        nodes.push(node);
        return node;
      }),
    });
    // Fail streaming to exercise the real engine's bundled network fallback.
    mocks.transport.mockReturnValue({
      warm: vi.fn(),
      send: vi.fn().mockRejectedValue(new Error('offline')),
      cancel: vi.fn(),
      close: vi.fn(),
    });
    const speaks: Events['speak'][] = [];
    const ended: Events['speechEnded'][] = [];
    bus.on('speak', (request) => speaks.push(request));
    bus.on('speechEnded', (event) => ended.push(event));
    mocks.detector.mockResolvedValue({
      detect: () =>
        ms >= 4500 ? [{ cls: 'person', score: 0.9, box: { x: 0.4, y: 0.5, w: 0.2, h: 0.4 } }] : [],
      close: vi.fn(),
    });
    const voice = createVoiceModule();
    const frames = new Map<number, () => void>();
    let nextFrame = 0;
    const map =
      mapMode === 'mock'
        ? createMockMap()
        : createMapModule({
            request(cb) {
              frames.set(++nextFrame, cb);
              return nextFrame;
            },
            cancel(id) {
              frames.delete(id);
            },
          });
    const flush = () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((cb) => cb());
    };
    const modules = [
      map,
      mapMode === 'all-real' ? createVisionModule() : createMockVision(),
      voice,
      createArbiter(),
    ];
    const advance = async (to: number) => {
      while (ms < to) {
        ms += 100;
        flush();
        await vi.advanceTimersByTimeAsync(100);
      }
    };
    try {
      await Promise.all(modules.map((module) => module.start(ctx)));
      await voice.enableAudio();
      bus.emit('tripState', { state: 'playing' });
      flush();
      await advance(3100);
      expect(speaks[0]?.fallbackClipKey).toBe('stopSign');
      expect(nodes).toHaveLength(1);
      nodes[0]!.start();
      await advance(5000);
      expect(speaks[1]?.clipKey).toBe('pedestrianNearby');
      expect(nodes[0]!.stop).toHaveBeenCalled();
      expect(ended).toContainEqual({ id: speaks[0]!.id, interrupted: true });
      expect(nodes).toHaveLength(2);
      nodes[1]!.start();
      nodes[1]!.end();
      await advance(7000);
      bus.emit('voiceCommand', { kind: 'repeat', transcript: 'repeat that' });
      await vi.advanceTimersByTimeAsync(0);
      expect(speaks.at(-1)?.text).toBe(speaks[0]!.text);
      expect(nodes).toHaveLength(3);
      bus.emit('tripState', { state: 'paused' });
      expect(nodes[2]!.stop).toHaveBeenCalled();
      ms = 0;
      resets.forEach((reset) => reset(0));
      bus.emit('tripReset', { tripMs: 0 });
      bus.emit('tripState', { state: 'playing' });
      flush();
      await advance(5000);
      expect(speaks.filter((request) => request.priority === 0)).toHaveLength(2);
      expect(new Set(speaks.map((request) => request.id)).size).toBe(speaks.length);
    } finally {
      modules.forEach((module) => module.stop());
    }
  },
);
