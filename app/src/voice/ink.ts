import { fetchCartesiaToken } from './token.ts';
import { VoiceSetupError } from './setupError.ts';
import { CARTESIA_VERSION } from './config.ts';
import { encodePcm } from './pcm.ts';

export type InkSession = { send(samples: Float32Array): void; finish(): void; cancel(): void };
export async function openInk(options: {
  sampleRate: number;
  signal: AbortSignal;
  onTranscript: (text: string) => void;
  onComplete: () => void;
  onError: () => void;
}): Promise<InkSession> {
  const { signal } = options;
  const token = await fetchCartesiaToken(signal);
  signal.throwIfAborted();
  const query = new URLSearchParams({
    access_token: token,
    cartesia_version: CARTESIA_VERSION,
    model: 'ink-2',
    encoding: 'pcm_s16le',
    sample_rate: String(options.sampleRate),
    language: 'en',
  });
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
        reject(new VoiceSetupError('timeout'));
      }, 10000);
      ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new VoiceSetupError('micConnection'));
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        reject(new VoiceSetupError('micConnection'));
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
  return {
    send(samples) {
      if (!closed && !finishing && !signal.aborted && ws.readyState === WebSocket.OPEN)
        ws.send(encodePcm(samples));
    },
    finish() {
      if (closed || finishing) return;
      finishing = true;
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
