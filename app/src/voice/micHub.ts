// One microphone stream for a hands-free drive, shared by the wake-word detector and the request
// recorder: iPhones handle a second simultaneous capture badly, and switching the audio session for
// every request interrupted the camera. Keeps the last PREROLL_KEEP_MS of audio so the words said
// right after the wake word are not lost while the recorder starts. Audio never leaves the device
// from here; only a talk session forwards it to Ink.
import { openCapture, type CaptureSession } from './capture.ts';

export const PREROLL_KEEP_MS = 2000;

type Listener = (samples: Float32Array) => void;

export function createMicHub(open: typeof openCapture = openCapture) {
  let session: CaptureSession | undefined;
  let controller: AbortController | undefined;
  let starting: Promise<void> | undefined;
  const listeners = new Set<Listener>();
  let ring: Float32Array[] = [];
  let ringSamples = 0;

  const keepSamples = () => ((session?.sampleRate ?? 48000) * PREROLL_KEEP_MS) / 1000;

  function deliver(samples: Float32Array) {
    ring.push(samples);
    ringSamples += samples.length;
    while (ring.length > 1 && ringSamples - ring[0]!.length >= keepSamples())
      ringSamples -= ring.shift()!.length;
    listeners.forEach((listener) => listener(samples));
  }

  function recent(ms: number): Float32Array[] {
    const want = ((session?.sampleRate ?? 48000) * ms) / 1000;
    const out: Float32Array[] = [];
    let total = 0;
    for (let i = ring.length - 1; i >= 0 && total < want; i--) {
      out.unshift(ring[i]!);
      total += ring[i]!.length;
    }
    return out;
  }

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    async start(): Promise<void> {
      if (session) return;
      if (starting) return starting;
      controller = new AbortController();
      starting = open(deliver, controller.signal)
        .then((s) => {
          session = s;
        })
        .finally(() => {
          starting = undefined;
        });
      return starting;
    },
    stop() {
      controller?.abort();
      session?.stop();
      session = undefined;
      ring = [];
      ringSamples = 0;
    },
    running: () => session !== undefined,
    sampleRate: () => session?.sampleRate,
    subscribe,
    recent,
    // An openCapture-compatible source for a talk session: replays `preRollMs` of recent audio,
    // then forwards the live stream until stopped. Opens the microphone itself when the hub is off.
    captureFor(preRollMs = 0): typeof openCapture {
      return async (onSamples, signal) => {
        if (!session) return open(onSamples, signal);
        const rate = session.sampleRate;
        for (const chunk of recent(preRollMs)) onSamples(chunk);
        const off = subscribe(onSamples);
        signal.addEventListener('abort', off, { once: true });
        return { sampleRate: rate, stop: off };
      };
    },
  };
}

export type MicHub = ReturnType<typeof createMicHub>;
