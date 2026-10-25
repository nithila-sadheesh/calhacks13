import { parseDelivery } from '../../../shared/delivery.ts';
import type { Delivery } from '../../../shared/types.ts';
import { CARTESIA_VERSION, SAMPLE_RATE, SONIC_MODEL, VOICE_ID } from './config.ts';
import { decodePcm } from './pcm.ts';

// Sonic treats speed as guidance and small changes are hard to hear, so 'slower' is a clear step.
export const SLOWER_SPEED = 0.8;

export type GenerationConfig = { emotion: string; speed?: number; volume?: number };

// Claude's delivery for this sentence becomes Sonic's generation_config. Lines without one
// (templates, clips) keep the calm default at Sonic's own speed and volume. Anything off the shared
// list or out of bounds falls back to that default rather than reaching Sonic.
export function generationConfig(delivery?: Delivery): GenerationConfig {
  const checked = parseDelivery(delivery);
  if (!checked) return { emotion: 'calm' };
  const config: GenerationConfig = { emotion: checked.emotion };
  const speed = checked.speed ?? (checked.pace === 'slower' ? SLOWER_SPEED : undefined);
  if (speed !== undefined) config.speed = speed;
  if (checked.volume !== undefined) config.volume = checked.volume;
  return config;
}

export type SonicMessage =
  | { id: string; type: 'chunk'; samples: Float32Array }
  | { id: string; type: 'done' }
  | { id: string; type: 'error' };
export type SonicTransport = {
  // Opens the session ahead of the first request. Best effort: send() connects if this failed.
  warm(): void;
  send(id: string, text: string, delivery?: Delivery): Promise<void>;
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
    if (stopped) throw new Error('Voice stopped');
    if (socket?.readyState === WebSocket.OPEN) return socket;
    if (connecting) return connecting;
    connecting = (async () => {
      controller = new AbortController();
      const response = await fetch('/api/cartesia-token', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok) throw new Error('Token request failed');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string')
        throw new Error('Invalid token');
      if (stopped) throw new Error('Voice stopped');
      const params = new URLSearchParams({
        access_token: body.token,
        cartesia_version: CARTESIA_VERSION,
      });
      const ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?${params}`);
      socket = ws;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('Sonic timeout'));
        }, 10000);
        ws.onopen = () => {
          clearTimeout(timer);
          retryMs = 500;
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Sonic connection failed'));
        };
        ws.onclose = () => {
          clearTimeout(timer);
          reject(new Error('Sonic closed'));
        };
      });
      if (stopped) {
        ws.close();
        throw new Error('Voice stopped');
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
    warm() {
      void connect().catch(() => {
        /* The first send() retries the connection. */
      });
    },
    async send(id, text, delivery) {
      const ws = await connect();
      if (stopped || cancelled.has(id)) return;
      ws.send(
        JSON.stringify({
          model_id: SONIC_MODEL,
          voice: VOICE_ID,
          transcript: text,
          language: 'en',
          generation_config: generationConfig(delivery),
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
