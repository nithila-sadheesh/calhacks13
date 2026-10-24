import { VoiceSetupError } from './setupError.ts';
import { log } from '../../../shared/log.ts';
import type { AppModule, ModuleContext } from '../../../shared/types.ts';
import { createPushToTalk, type MicStatus } from './pushToTalk.ts';
import { loadClips } from './clips.ts';
import { createVoiceEngine } from './engine.ts';
import { createAudioPlayer, type AudioPlayer } from './player.ts';
import { createSonicTransport } from './sonic.ts';

export function createVoiceModule(): AppModule & {
  enableAudio(): Promise<void>;
  pressToTalk(): Promise<void>;
  releaseToTalk(): void;
  cancelTalk(): void;
  micStatus(): MicStatus;
  onMicStatus(listener: () => void): () => void;
} {
  let mic: ReturnType<typeof createPushToTalk> | undefined;
  let micStatus: MicStatus = 'idle';
  const micListeners = new Set<() => void>();
  const updateMic = (status: MicStatus) => {
    micStatus = status;
    micListeners.forEach((listener) => listener());
  };
  let engine: ReturnType<typeof createVoiceEngine> | undefined;
  let player: AudioPlayer | undefined;
  let controller: AbortController | undefined;
  let off: Array<() => void> = [];
  let version = 0;
  function stop() {
    version++;
    mic?.cancel();
    mic = undefined;
    controller?.abort();
    off.forEach((dispose) => dispose());
    off = [];
    if (engine) engine.stop();
    else player?.close();
    engine = undefined;
    player = undefined;
  }
  return {
    name: 'voice',
    async start(ctx: ModuleContext) {
      stop();
      const mine = version;
      controller = new AbortController();
      const clips = await loadClips(
        AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      ).catch(() => new Map());
      if (mine !== version) return;
      player = createAudioPlayer();
      engine = createVoiceEngine({
        bus: ctx.bus,
        clock: ctx.clock,
        player,
        clips,
        transport: (receive, disconnect) =>
          createSonicTransport(receive, disconnect, (text) =>
            ctx.bus.emit('dataSent', {
              destination: 'cartesia-tts',
              summary: `text: "${text}"`,
              tripMs: ctx.clock.nowMs(),
            }),
          ),
      });
      mic = createPushToTalk({ bus: ctx.bus, clock: ctx.clock, status: updateMic });
      off = [
        ctx.bus.on('speak', (request) => engine?.speak(request)),
        ctx.bus.on('tripReset', () => {
          engine?.reset();
          mic?.cancel();
        }),
        ctx.bus.on('tripState', ({ state }) => {
          if (state === 'paused' || state === 'ended') {
            engine?.reset();
            mic?.cancel();
          }
        }),
      ];
      log('voice', 'ready', { clipsLoaded: clips.size });
    },
    async enableAudio() {
      if (!player) throw new VoiceSetupError('loading');
      try {
        await player.enable();
      } catch {
        throw new VoiceSetupError('audio');
      }
      // Establish the session before replay so token/WebSocket setup does not consume
      // the first spoken line's 1.5 s audio deadline.
      await engine?.prepare();
    },
    async pressToTalk() {
      if (mic) await mic.press();
    },
    releaseToTalk() {
      mic?.release();
    },
    cancelTalk() {
      mic?.cancel();
    },
    micStatus: () => micStatus,
    onMicStatus(listener) {
      micListeners.add(listener);
      return () => {
        micListeners.delete(listener);
      };
    },
    stop,
  };
}
export const voiceModule = createVoiceModule();
