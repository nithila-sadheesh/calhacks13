import { CARTESIA_VERSION, SAMPLE_RATE, SONIC_MODEL, VOICE_ID } from './config.ts';
import { VoiceSetupError } from './setupError.ts';
import { decodePcm } from './pcm.ts';

export type SonicMessage =
  | { id: string; type: 'chunk'; samples: Float32Array }
  | { id: string; type: 'done' }
  | { id: string; type: 'error' };
export type SonicTransport = {
  warmup?(): Promise<void>;
  send(id: string, text: string): Promise<void>;
  cancel(id: string): void;
  close(): void;
};
export function createSonicTransport(
  onMessage: (message: SonicMessage) => void,
  onDisconnect: () => void,
  onSent: (text: string) => void,
): SonicTransport {
  let socket: WebSocket | undefined;
  let connecting: Promise<WebSocket> | undefined;
  let stopped = false;
  let controller: AbortController | undefined;
  const cancelled = new Set<string>();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 500;
  async function connect(): Promise<WebSocket> {
    if (stopped) throw new VoiceSetupError('stopped');
    if (socket?.readyState === WebSocket.OPEN) return socket;
    if (connecting) return connecting;
    connecting = (async () => {
      controller = new AbortController();
      const response = await fetch('/api/cartesia-token', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      }).catch(() => {
        throw new VoiceSetupError('tokenNetwork');
      });
      if (!response.ok) {
        const code =
          response.status === 503
            ? 'tokenKey'
            : response.status === 401 || response.status === 403
              ? 'tokenAuth'
              : response.status === 429
                ? 'tokenRate'
                : 'tokenHttp';
        throw new VoiceSetupError(code);
      }
      const body: unknown = await response.json().catch(() => {
        throw new VoiceSetupError('tokenInvalid');
      });
      if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string')
        throw new VoiceSetupError('tokenInvalid');
      if (stopped) throw new VoiceSetupError('stopped');
      const params = new URLSearchParams({
        access_token: body.token,
        cartesia_version: CARTESIA_VERSION,
      });
      const ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?${params}`);
      socket = ws;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new VoiceSetupError('timeout'));
          ws.close();
        }, 10000);
        ws.onopen = () => {
          clearTimeout(timer);
          retryMs = 500;
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new VoiceSetupError('connection'));
        };
        ws.onclose = () => {
          clearTimeout(timer);
          reject(new VoiceSetupError('connection'));
        };
      });
      if (stopped) {
        ws.close();
        throw new VoiceSetupError('stopped');
      }
      ws.onmessage = (event) => {
        try {
          const message: unknown = JSON.parse(String(event.data));
          if (!message || typeof message !== 'object') return;
          const m = message as Record<string, unknown>;
          if (typeof m.context_id !== 'string') {
            if (m.type === 'error') ws.close();
            return;
          }
          if (cancelled.has(m.context_id)) {
            if (m.type === 'done' || m.type === 'error') cancelled.delete(m.context_id);
            return;
          }
          if (m.type === 'chunk' && typeof m.data === 'string')
            onMessage({ id: m.context_id, type: 'chunk', samples: decodePcm(m.data) });
          else if (m.type === 'done' || m.type === 'error')
            onMessage({ id: m.context_id, type: m.type });
        } catch {
          ws.close();
        }
      };
      const lost = () => {
        if (socket !== ws || stopped) return;
        socket = undefined;
        onDisconnect();
        clearTimeout(retry);
        retry = setTimeout(() => {
          void connect().catch(() => {
            /* Next request also reconnects. */
          });
        }, retryMs);
        retryMs = Math.min(10000, retryMs * 2);
      };
      ws.onclose = lost;
      ws.onerror = () => ws.close();
      return ws;
    })();
    try {
      return await connecting;
    } finally {
      connecting = undefined;
    }
  }
  return {
    async warmup() {
      await connect();
    },
    async send(id, text) {
      const ws = await connect();
      if (stopped || cancelled.has(id)) return;
      ws.send(
        JSON.stringify({
          model_id: SONIC_MODEL,
          voice: VOICE_ID,
          transcript: text,
          language: 'en',
          generation_config: { emotion: 'calm' },
          context_id: id,
          continue: false,
          max_buffer_delay_ms: 0,
          output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE },
        }),
      );
      onSent(text);
    },
    cancel(id) {
      cancelled.add(id);
      if (cancelled.size > 256) cancelled.delete(cancelled.values().next().value!);
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ context_id: id, cancel: true }));
    },
    close() {
      stopped = true;
      clearTimeout(retry);
      controller?.abort();
      socket?.close();
      cancelled.clear();
    },
  };
}
