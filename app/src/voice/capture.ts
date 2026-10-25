import { enterCaptureSession } from './audioSession.ts';
export type CaptureSession = { sampleRate: number; stop(): void };

const WORKLET_URL = new URL('./captureWorklet.js?no-inline', import.meta.url);
type Shared = { context: AudioContext; loaded: Promise<void> };
let shared: Shared | undefined;

// One capture context per page with the worklet loaded once, so a tap only has to open the
// microphone. Rebuilding both on every tap cost ~0.3 s, and speech in that gap was lost.
function sharedContext(): Shared {
  if (shared && shared.context.state !== 'closed') return shared;
  const context = new AudioContext({ sampleRate: 48000 });
  const loaded = context.audioWorklet.addModule(WORKLET_URL);
  const entry = { context, loaded };
  shared = entry;
  // A failed load starts over with a fresh context on the next tap.
  loaded.catch(() => {
    if (shared === entry) shared = undefined;
    if (context.state !== 'closed') void context.close().catch(() => {});
  });
  return entry;
}

// Loads the capture worklet ahead of the first tap. No microphone is opened.
export function prepareCapture(): void {
  sharedContext();
}

// Call inside a tap: iOS only lets an audio context start from a user gesture. Hands-free opens
// the microphone a few awaits after Start drive, outside the gesture, so it is woken here first.
export function wakeCaptureContext(): void {
  void sharedContext()
    .context.resume()
    .catch(() => {});
}

export function disposeCapture(): void {
  const entry = shared;
  shared = undefined;
  if (entry && entry.context.state !== 'closed') void entry.context.close().catch(() => {});
}

export async function openCapture(
  onSamples: (samples: Float32Array) => void,
  signal: AbortSignal,
): Promise<CaptureSession> {
  const { context, loaded } = sharedContext();
  // Request resume in the originating pointer/key gesture, before any permission wait.
  const resumed = context.resume();
  void resumed.catch(() => {});
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let stopped = false;
  // Before getUserMedia: WebKit rejects capture under the 'playback' session the player uses.
  const restoreSession = enterCaptureSession();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
    restoreSession();
    if (node) {
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
    }
    source?.disconnect();
    // Kept for the next tap; suspended so it costs nothing while the mic is closed.
    if (context.state === 'running') void context.suspend().catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    // Permission prompts cannot be cancelled; stop tracks if release happened meanwhile.
    if (signal.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Capture cancelled');
    }
    await resumed;
    await loaded;
    signal.throwIfAborted();
    node = new AudioWorkletNode(context, 'voice-capture');
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!stopped && !signal.aborted && event.data instanceof Float32Array) onSamples(event.data);
    };
    source = context.createMediaStreamSource(stream);
    source.connect(node);
    node.connect(context.destination);
    return {
      sampleRate: context.sampleRate,
      stop: () => {
        signal.removeEventListener('abort', stop);
        stop();
      },
    };
  } catch (error: unknown) {
    stop();
    signal.removeEventListener('abort', stop);
    throw error;
  }
}
