import { CARTESIA_VERSION } from './config.ts';
import { encodePcm } from './pcm.ts';

export type InkSession = { send(samples: Float32Array): void; finish(): void; cancel(): void };

// Ink recommends ~100 ms audio frames; the capture worklet delivers ~20 ms.
export const FRAME_S = 0.1;
// Ink-2 limits: at most 100 keyterms, 1200 characters in all.
export const MAX_KEYTERMS = 100;
export const MAX_KEYTERM_CHARS = 1200;

// Query string by hand: Ink wants multi-word keyterms with %20, and URLSearchParams writes '+'.
export function inkQuery(params: Record<string, string>, keyterms: readonly string[] = []): string {
  const parts = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  let chars = 0;
  for (const term of keyterms.slice(0, MAX_KEYTERMS)) {
    chars += term.length;
    if (chars > MAX_KEYTERM_CHARS) break;
    parts.push(`keyterm=${encodeURIComponent(term)}`);
  }
  return parts.join('&');
}

export async function openInk(options: {
  sampleRate: number;
  // Words and phrases Ink should favor: the voice commands, driving terms, street names.
  keyterms?: readonly string[];
  signal: AbortSignal;
  onTranscript: (text: string) => void;
  onComplete: () => void;
  onError: () => void;
}): Promise<InkSession> {
  const { signal } = options;
  const response = await fetch('/api/cartesia-token', {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok) throw new Error('Ink token request failed');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string')
    throw new Error('Invalid Ink token');
  signal.throwIfAborted();
  // No `language`: the docs list it for ink-whisper only.
  const query = inkQuery(
    {
      access_token: body.token,
      cartesia_version: CARTESIA_VERSION,
      model: 'ink-2',
      encoding: 'pcm_s16le',
      sample_rate: String(options.sampleRate),
    },
    options.keyterms,
  );
  const ws = new WebSocket(`wss://api.cartesia.ai/stt/websocket?${query}`);
  let finishing = false;
  let completed = false;
  const complete = () => {
    if (finishing && !completed) {
      completed = true;
      options.onComplete();
    }
  };
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    ws.close();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cancel();
        reject(new Error('Ink connection timeout'));
      }, 10000);
      ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Ink connection failed'));
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        reject(new Error('Ink connection closed'));
      };
    });
    signal.throwIfAborted();
  } catch (error: unknown) {
    cancel();
    throw error;
  }
  const failed = () => {
    if (!closed) {
      cancel();
      options.onError();
    }
  };
  ws.onmessage = (event) => {
    if (closed) return;
    try {
      const raw: unknown = JSON.parse(String(event.data));
      if (!raw || typeof raw !== 'object') return;
      const message = raw as Record<string, unknown>;
      if (
        message.type === 'transcript' &&
        message.is_final === true &&
        typeof message.text === 'string'
      )
        options.onTranscript(message.text);
      if (message.type === 'flush_done' && finishing) {
        ws.send('close');
        complete();
      }
      if (message.type === 'done') {
        complete();
        cancel();
      }
      if (message.type === 'error') failed();
    } catch {
      failed();
    }
  };
  ws.onerror = failed;
  ws.onclose = () => {
    if (!closed) failed();
    else cancel();
  };
  const frameSamples = Math.round(options.sampleRate * FRAME_S);
  let frame: Float32Array[] = [];
  let frameLength = 0;
  const flush = () => {
    if (frameLength === 0) return;
    const joined = new Float32Array(frameLength);
    let offset = 0;
    for (const chunk of frame) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    frame = [];
    frameLength = 0;
    ws.send(encodePcm(joined));
  };
  return {
    send(samples) {
      if (closed || finishing || signal.aborted || ws.readyState !== WebSocket.OPEN) return;
      frame.push(samples);
      frameLength += samples.length;
      if (frameLength >= frameSamples) flush();
    },
    finish() {
      if (closed || finishing) return;
      finishing = true;
      // The last partial frame holds the end of the sentence.
      if (ws.readyState === WebSocket.OPEN) flush();
      ws.send('finalize');
      timer = setTimeout(() => {
        if (!closed) {
          cancel();
          options.onError();
        }
      }, 5000);
    },
    cancel,
  };
}
