import { afterEach, expect, it, vi } from 'vitest';
import { createBus } from '../../shared/bus.ts';
import type { ModuleContext, SpeakRequest } from '../../shared/types.ts';
import { createFrameVisionModule as createVisionModule } from '../../app/src/vision/frameRuntime.ts';
import { createVisionModule as createHybridVisionModule } from '../../app/src/vision/index.ts';
import { createArbiter } from '../../app/src/arbiter/index.ts';
import { createVoiceModule } from '../../app/src/voice/index.ts';
import type { SonicMessage } from '../../app/src/voice/sonic.ts';
const mocks = vi.hoisted(() => ({ player: vi.fn(), transport: vi.fn() }));
vi.mock('../../app/src/voice/clips.ts', () => ({ loadClips: async () => new Map() }));
vi.mock('../../app/src/voice/player.ts', () => ({ createAudioPlayer: mocks.player }));
vi.mock('../../app/src/voice/sonic.ts', () => ({ createSonicTransport: mocks.transport }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it.each(['frames', 'cv'] as const)(
  'streams %s coaching through real arbiter/voice and repeats it, while maps remain silent',
  async (mode) => {
    vi.useFakeTimers();
    let ms = 0;
    const bus = createBus();
    const ctx: ModuleContext = {
      source: 'replay',
      bus,
      clock: { nowMs: () => ms, onReset: () => () => {} },
      video: { paused: false, ended: false, readyState: 4, videoWidth: 1280 } as HTMLVideoElement,
      fixtures: {
        track: { points: [], syncOffsetMs: 0 },
        features: [],
        route: { coordinates: [] },
      },
    };
    const text = 'Keep the car on your left in view.';
    const delivery = { emotion: 'confident', pace: 'normal', speed: 1.1, volume: 1.05 } as const;
    const analyze = async () => ({
      delivery,
      shouldSpeak: true,
      message: text,
      reason: 'Car visible in the left image region.',
    });
    const vision =
      mode === 'cv'
        ? createHybridVisionModule({
            analyze,
            loadDetector: async () => ({
              detect: () => [{ cls: 'car', score: 0.9, box: { x: 0.1, y: 0.4, w: 0.2, h: 0.2 } }],
              close: () => {},
            }),
          })
        : createVisionModule({
            capture: (_video, tripMs) => ({ tripMs, jpeg: '/9j/AA==' }),
            analyze,
          });
    const send = vi.fn().mockResolvedValue(undefined);
    let receive!: (message: SonicMessage) => void;
    mocks.transport.mockImplementation((callback: typeof receive) => {
      receive = callback;
      return { warm: vi.fn(), send, cancel: vi.fn(), close: vi.fn() };
    });
    const nodes: Array<{ start: () => void; end: () => void; stop: () => void }> = [];
    mocks.player.mockReturnValue({
      ready: () => true,
      enable: async () => {},
      close: vi.fn(),
      play: (_samples: Float32Array, start: () => void, end: () => void) => {
        const node = { start, end, stop: vi.fn() };
        nodes.push(node);
        return node;
      },
    });
    const voice = createVoiceModule();
    const modules = [vision, voice, createArbiter({ mapReminders: false })];
    const speaks: SpeakRequest[] = [];
    bus.on('speak', (value) => speaks.push(value));
    const started = vi.fn();
    bus.on('speechStarted', started);
    try {
      await Promise.all(modules.map((module) => module.start(ctx)));
      bus.emit('tripState', { state: 'playing' });
      bus.emit('mapCue', {
        id: 'map',
        featureId: 'stop',
        featureKind: 'stopSign',
        text: 'Stop sign ahead. Prepare for a complete stop.',
        reason: 'fixture',
        priority: 1,
        earliestMs: 0,
        expiresMs: 5000,
      });
      expect(send).not.toHaveBeenCalled();
      for (let i = 0; i < 30 && !send.mock.calls.length; i++) {
        ms += 100;
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(speaks[0]).toMatchObject({ text, origin: 'vision', priority: 1, delivery });
      expect(send).toHaveBeenCalledWith(expect.any(String), text, delivery);
      const id = send.mock.calls[0]![0] as string;
      receive({ id, type: 'chunk', samples: new Float32Array([0.1]) });
      nodes[0]!.start();
      expect(started).toHaveBeenCalledWith(expect.objectContaining({ id: speaks[0]!.id }));
      receive({ id, type: 'done' });
      nodes[0]!.end();
      ms += 1200;
      await vi.advanceTimersByTimeAsync(1200);
      bus.emit('voiceCommand', { kind: 'repeat', transcript: 'repeat that' });
      expect(send).toHaveBeenCalledTimes(2);
      expect(speaks[1]?.text).toBe(text);
      bus.emit('tripReset', { tripMs: 0 });
      receive({ id, type: 'chunk', samples: new Float32Array([0.1]) });
      expect(nodes).toHaveLength(1);
    } finally {
      modules.forEach((module) => module.stop());
    }
  },
);
