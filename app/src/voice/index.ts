import { log } from '../../../shared/log.ts';
import type { AppModule, ModuleContext } from '../../../shared/types.ts';
import { enterPlaybackSession } from './audioSession.ts';
import { disposeCapture, prepareCapture } from './capture.ts';
import { readyTone } from './pcm.ts';
import { createPushToTalk, type MicStatus } from './pushToTalk.ts';
import { loadClips } from './clips.ts';
import { createVoiceEngine } from './engine.ts';
import { createAudioPlayer, type AudioPlayer } from './player.ts';
import { SAMPLE_RATE } from './config.ts';
import { createSonicTransport, type SonicTransport } from './sonic.ts';

const READY_TONE = readyTone(SAMPLE_RATE);

export function createVoiceModule(): AppModule & {
  enableAudio(): Promise<void>;
  audioReady(): boolean;
  onAudioReady(listener: () => void): () => void;
  toggleTalk(): void;
  cancelTalk(): void;
  micStatus(): MicStatus;
  onMicStatus(listener: () => void): () => void;
} {
  let mic: ReturnType<typeof createPushToTalk> | undefined;
  let micStatus: MicStatus = 'idle';
  const micListeners = new Set<() => void>();
  const audioListeners = new Set<() => void>();
  const notifyAudio = () => audioListeners.forEach((listener) => listener());
  const updateMic = (status: MicStatus) => {
    // A short chime when recording really starts, so the speaker knows to talk without looking.
    if (status === 'listening' && micStatus !== 'listening' && player?.ready())
      player.play(
        READY_TONE,
        () => {},
        () => {},
      );
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
    disposeCapture();
    controller?.abort();
    off.forEach((dispose) => dispose());
    off = [];
    if (engine) engine.stop();
    else player?.close();
    engine = undefined;
    player = undefined;
    notifyAudio();
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
      let sonic: SonicTransport | undefined;
      player = createAudioPlayer();
      engine = createVoiceEngine({
        bus: ctx.bus,
        clock: ctx.clock,
        player,
        clips,
        transport: (receive, disconnect) =>
          (sonic = createSonicTransport(receive, disconnect, (text) =>
            ctx.bus.emit('dataSent', {
              destination: 'cartesia-tts',
              summary: `text: "${text}"`,
              tripMs: ctx.clock.nowMs(),
            }),
          )),
      });
      // Connect now, not on the first reminder: a cold token fetch plus the WebSocket handshake
      // takes about 2.5 s, past the engine's 1.5 s first-audio deadline, so the first reminder
      // would always fall back to a clip. The transport reconnects by itself if the session drops.
      sonic?.warm();
      mic = createPushToTalk({ bus: ctx.bus, clock: ctx.clock, status: updateMic });
      // Load the capture worklet now, so the first tap only has to open the microphone.
      try {
        prepareCapture();
      } catch (e: unknown) {
        log('voice', 'capture preload failed', String(e));
      }
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
      if (!player) throw new Error('Voice is still loading.');
      // iOS mutes Web Audio while the ring/silent switch is on, unless the page declares a
      // playback session. Capture switches it temporarily (audioSession.ts).
      enterPlaybackSession();
      try {
        await player.enable();
      } finally {
        notifyAudio();
      }
    },
    audioReady: () => player?.ready() ?? false,
    onAudioReady(listener) {
      audioListeners.add(listener);
      return () => {
        audioListeners.delete(listener);
      };
    },
    toggleTalk() {
      mic?.toggle();
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
