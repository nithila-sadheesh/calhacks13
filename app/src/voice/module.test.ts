import { afterEach, expect, it, vi } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import type { ModuleContext } from '../../../shared/types.ts';
import { createVoiceModule } from './index.ts';
import { CLIP_TEXT } from './config.ts';
const mocks = vi.hoisted(() => ({ load: vi.fn(), player: vi.fn(), transport: vi.fn() }));
vi.mock('./clips.ts', () => ({ loadClips: mocks.load }));
vi.mock('./player.ts', () => ({ createAudioPlayer: mocks.player }));
vi.mock('./sonic.ts', () => ({ createSonicTransport: mocks.transport }));
function setup() {
  mocks.load.mockReset().mockResolvedValue(new Map([['pedestrianNearby', new Float32Array([0])]]));
  const stop = vi.fn();
  const close = vi.fn();
  const enable = vi.fn().mockResolvedValue(undefined);
  const play = vi.fn(() => ({ stop }));
  mocks.player.mockReset().mockReturnValue({ ready: () => true, play, close, enable });
  const socketClose = vi.fn();
  mocks.transport
    .mockReset()
    .mockReturnValue({
      send: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      close: socketClose,
    });
  const bus = createBus();
  const ctx: ModuleContext = {
    bus,
    clock: { nowMs: () => 0, onReset: () => () => {} },
    video: {} as HTMLVideoElement,
    fixtures: { track: { points: [], syncOffsetMs: 0 }, features: [], route: { coordinates: [] } },
  };
  const module = createVoiceModule();
  const alert = () =>
    bus.emit('speak', {
      id: 'alert',
      sourceId: 'alert',
      text: CLIP_TEXT.pedestrianNearby,
      clipKey: 'pedestrianNearby',
      priority: 0,
    });
  return { module, ctx, alert, bus, stop, close, socketClose, enable, play };
}
afterEach(() => vi.clearAllMocks());
it('wires bus playback and stops active sound on reset, pause and module disposal', async () => {
  const s = setup();
  await s.module.start(s.ctx);
  await s.module.enableAudio();
  expect(s.enable).toHaveBeenCalledTimes(1);
  s.alert();
  s.bus.emit('tripReset', { tripMs: 0 });
  expect(s.stop).toHaveBeenCalledTimes(1);
  s.alert();
  s.bus.emit('tripState', { state: 'paused' });
  expect(s.stop).toHaveBeenCalledTimes(2);
  s.alert();
  s.module.stop();
  expect(s.stop).toHaveBeenCalledTimes(3);
  s.alert();
  expect(s.play).toHaveBeenCalledTimes(3);
  expect(s.close).toHaveBeenCalledTimes(1);
  expect(s.socketClose).toHaveBeenCalledTimes(1);
});
it('does not resurrect a module stopped while clips are loading', async () => {
  const s = setup();
  let resolve!: (clips: Map<string, Float32Array>) => void;
  mocks.load.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const pending = s.module.start(s.ctx);
  s.module.stop();
  resolve(new Map());
  await pending;
  expect(mocks.player).not.toHaveBeenCalled();
  s.alert();
  expect(s.play).not.toHaveBeenCalled();
});
it('restarting does not leave duplicate bus subscriptions or audio contexts', async () => {
  const s = setup();
  await s.module.start(s.ctx);
  await s.module.start(s.ctx);
  s.alert();
  expect(s.play).toHaveBeenCalledTimes(1);
  expect(s.close).toHaveBeenCalledTimes(1);
  s.module.stop();
});
