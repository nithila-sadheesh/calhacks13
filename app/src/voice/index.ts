import { log } from '../../../shared/log.ts';
import type { AppModule, ModuleContext } from '../../../shared/types.ts';
import { enterPlaybackSession } from './audioSession.ts';
import { disposeCapture, prepareCapture, wakeCaptureContext } from './capture.ts';
import { readyTone } from './pcm.ts';
import { createPushToTalk, type MicStatus } from './pushToTalk.ts';
import { loadClips } from './clips.ts';
import { createVoiceEngine } from './engine.ts';
import { createAudioPlayer, type AudioPlayer } from './player.ts';
import { inkKeyterms, SAMPLE_RATE } from './config.ts';
import { createSonicTransport, type SonicTransport } from './sonic.ts';
import { createMicHub } from './micHub.ts';
import { createResampler } from './framer.ts';
import { FEATURE_RATE } from './features.ts';
import {
  createWakeDetector,
  enroll,
  ENROLL_TAKES,
  isWakeModel,
  type WakeDetector,
  type WakeModel,
} from './wakeword.ts';

export type HandsFree =
  | { state: 'off' }
  | { state: 'untaught' }
  | { state: 'teaching'; take: number; of: number }
  | { state: 'starting' }
  | { state: 'on' }
  | { state: 'error'; message: string };

// Audio kept from just before the wake word fired, so "Voya, repeat that" in one breath keeps its
// first words. Any of "Voya" it catches is stripped from the transcript.
const WAKE_PREROLL_MS = 500;
// Each enrollment take: a chime, then this long to say "Voya", then a short gap.
const TAKE_MS = 1800;
const BETWEEN_TAKES_MS = 600;

// Hands-free is on unless the user turned it off on this device.
const HANDS_FREE_KEY = 'learner-copilot.handsFree';
const WAKE_MODEL_KEY = 'learner-copilot.voyaModel';
export function handsFreePreferred(): boolean {
  try {
    return localStorage.getItem(HANDS_FREE_KEY) !== 'off';
  } catch {
    return true;
  }
}
function rememberHandsFree(on: boolean) {
  try {
    localStorage.setItem(HANDS_FREE_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}
// The user's own "Voya" recordings, as features: they stay on this device.
function storedWakeModel(): WakeModel | undefined {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(WAKE_MODEL_KEY) ?? 'null');
    return isWakeModel(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
function storeWakeModel(model: WakeModel | undefined) {
  try {
    if (model) localStorage.setItem(WAKE_MODEL_KEY, JSON.stringify(model));
    else localStorage.removeItem(WAKE_MODEL_KEY);
  } catch {
    // Private mode: the recordings last for this page only.
  }
}

const READY_TONE = readyTone(SAMPLE_RATE);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createVoiceModule(): AppModule & {
  enableAudio(): Promise<void>;
  audioReady(): boolean;
  onAudioReady(listener: () => void): () => void;
  toggleTalk(): void;
  cancelTalk(): void;
  micStatus(): MicStatus;
  onMicStatus(listener: () => void): () => void;
  startHandsFree(): Promise<void>;
  stopHandsFree(): void;
  setHandsFreePreferred(on: boolean): void;
  wakeForHandsFree(): void;
  teachWakeWord(): Promise<void>;
  handsFree(): HandsFree;
  onHandsFree(listener: () => void): () => void;
} {
  const hub = createMicHub();
  let model: WakeModel | undefined = storedWakeModel();
  let detector: WakeDetector | undefined;
  let offWakeFeed: (() => void) | undefined;
  // At rest: turned off on this device wins over "not taught yet" (it says off, with a button to
  // turn it on); otherwise untaught until there are recordings.
  const resting = (): HandsFree => ({ state: model || !handsFreePreferred() ? 'off' : 'untaught' });
  let handsFree: HandsFree = resting();
  let handsFreeRun = 0;
  const handsFreeListeners = new Set<() => void>();
  const setHandsFree = (next: HandsFree) => {
    handsFree = next;
    handsFreeListeners.forEach((listener) => listener());
  };
  function stopHandsFree() {
    handsFreeRun++;
    offWakeFeed?.();
    offWakeFeed = undefined;
    detector = undefined;
    hub.stop();
    if (handsFree.state !== 'error') setHandsFree(resting());
  }
  let mic: ReturnType<typeof createPushToTalk> | undefined;
  let micStatus: MicStatus = 'idle';
  const micListeners = new Set<() => void>();
  const audioListeners = new Set<() => void>();
  const notifyAudio = () => audioListeners.forEach((listener) => listener());
  const chime = () => {
    if (player?.ready())
      player.play(
        READY_TONE,
        () => {},
        () => {},
      );
  };
  const updateMic = (status: MicStatus) => {
    // A short chime when recording really starts, so the speaker knows to talk without looking.
    if (status === 'listening' && micStatus !== 'listening') chime();
    micStatus = status;
    micListeners.forEach((listener) => listener());
  };
  let engine: ReturnType<typeof createVoiceEngine> | undefined;
  let player: AudioPlayer | undefined;
  let controller: AbortController | undefined;
  let off: Array<() => void> = [];
  let version = 0;

  // Feeds the shared microphone, resampled to 16 kHz, to the wake-word detector.
  function listenForWakeWord(wakeModel: WakeModel) {
    const rate = hub.sampleRate();
    if (rate === undefined) return;
    const resampler = createResampler(rate, FEATURE_RATE);
    detector = createWakeDetector({
      model: wakeModel,
      onWake: () => {
        if (!mic || mic.listening()) return;
        log('voice', 'wake word heard');
        void mic.startHandsFree(hub.captureFor(WAKE_PREROLL_MS));
      },
    });
    offWakeFeed = hub.subscribe((samples) => detector?.feed(resampler.push(samples)));
    setHandsFree({ state: 'on' });
  }

  // Listens on the device for "Voya" for the rest of the drive. Call it from a tap (Start drive):
  // iOS grants the microphone and audio session most reliably inside a user gesture.
  async function startHandsFree() {
    if (['on', 'starting', 'teaching'].includes(handsFree.state)) return;
    if (!model) {
      setHandsFree({ state: 'untaught' });
      return;
    }
    const run = ++handsFreeRun;
    setHandsFree({ state: 'starting' });
    try {
      await hub.start();
      if (run !== handsFreeRun) return;
      listenForWakeWord(model);
    } catch (e: unknown) {
      if (run !== handsFreeRun) return;
      log('voice', 'hands-free unavailable', String(e));
      stopHandsFree();
      setHandsFree({
        state: 'error',
        message: e instanceof Error ? e.message : 'Hands-free could not start.',
      });
    }
  }

  // Records "Voya" ENROLL_TAKES times (a chime before each) and learns it, then starts listening.
  async function teachWakeWord() {
    if (handsFree.state === 'teaching') return;
    wakeCaptureContext();
    void player?.enable().catch(() => {});
    stopHandsFree();
    const run = ++handsFreeRun;
    try {
      await hub.start();
      const rate = hub.sampleRate();
      if (rate === undefined || run !== handsFreeRun) return;
      const takes: Float32Array[] = [];
      for (let take = 1; take <= ENROLL_TAKES; take++) {
        setHandsFree({ state: 'teaching', take, of: ENROLL_TAKES });
        chime();
        const resampler = createResampler(rate, FEATURE_RATE);
        const parts: Float32Array[] = [];
        const offTake = hub.subscribe((samples) => parts.push(resampler.push(samples)));
        await sleep(TAKE_MS);
        offTake();
        if (run !== handsFreeRun) return;
        const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
        let offset = 0;
        for (const p of parts) {
          audio.set(p, offset);
          offset += p.length;
        }
        takes.push(audio);
        await sleep(BETWEEN_TAKES_MS);
      }
      model = enroll(takes);
      storeWakeModel(model);
      log('voice', 'wake word learned', { threshold: model.threshold });
      listenForWakeWord(model);
    } catch (e: unknown) {
      if (run !== handsFreeRun) return;
      hub.stop();
      setHandsFree({
        state: 'error',
        message: e instanceof Error ? e.message : 'Could not learn the wake word.',
      });
    }
  }
  function stop() {
    version++;
    mic?.cancel();
    mic = undefined;
    stopHandsFree();
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
      mic = createPushToTalk({
        bus: ctx.bus,
        clock: ctx.clock,
        status: updateMic,
        // Taps read the shared microphone while hands-free is on, and open their own otherwise.
        capture: (onSamples, signal) => hub.captureFor(0)(onSamples, signal),
        keyterms: inkKeyterms(ctx.fixtures.features.map((f) => f.street)),
      });
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
          if (state === 'ended') stopHandsFree();
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
    startHandsFree,
    stopHandsFree() {
      stopHandsFree();
      setHandsFree({ state: 'off' });
    },
    // Turning it on or off from the panel also remembers the choice for future drives.
    setHandsFreePreferred(on) {
      rememberHandsFree(on);
      if (on) {
        wakeCaptureContext();
        void startHandsFree();
      } else {
        stopHandsFree();
        setHandsFree({ state: 'off' });
      }
    },
    wakeForHandsFree: wakeCaptureContext,
    teachWakeWord,
    handsFree: () => handsFree,
    onHandsFree(listener) {
      handsFreeListeners.add(listener);
      return () => {
        handsFreeListeners.delete(listener);
      };
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
