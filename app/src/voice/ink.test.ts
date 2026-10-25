import { afterEach, expect, it, vi } from 'vitest';
import { inkQuery, MAX_KEYTERMS, openInk } from './ink.ts';
class Socket {
  static OPEN = 1;
  static last: Socket;
  readyState = 0;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  sent: Array<string | ArrayBuffer> = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    Socket.last = this;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  message(body: unknown) {
    this.onmessage?.({ data: JSON.stringify(body) });
  }
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function setup(keyterms?: string[]) {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => Response.json({ token: 'temporary' })),
  );
  const controller = new AbortController();
  const onTranscript = vi.fn();
  const onComplete = vi.fn();
  const onError = vi.fn();
  const pending = openInk({
    sampleRate: 48000,
    signal: controller.signal,
    keyterms,
    onTranscript,
    onComplete,
    onError,
  });
  return { controller, onTranscript, onComplete, onError, pending };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('uses Ink-2 manual PCM, finalizes on release and drains the final transcript', async () => {
  const s = setup();
  await flush();
  Socket.last.open();
  const ink = await s.pending;
  const url = new URL(Socket.last.url);
  expect(url.searchParams.get('model')).toBe('ink-2');
  expect(url.searchParams.get('sample_rate')).toBe('48000');
  ink.send(new Float32Array([-1, 0, 1]));
  ink.finish();
  ink.send(new Float32Array([1]));
  expect(Socket.last.sent).toHaveLength(2);
  expect(Socket.last.sent[1]).toBe('finalize');
  Socket.last.message({ type: 'transcript', is_final: false, text: 'ignored' });
  Socket.last.message({ type: 'transcript', is_final: true, text: 'repeat that' });
  Socket.last.message({ type: 'flush_done' });
  expect(s.onTranscript).toHaveBeenCalledTimes(1);
  expect(s.onComplete).toHaveBeenCalledTimes(1);
  expect(Socket.last.sent.at(-1)).toBe('close');
  Socket.last.message({ type: 'done' });
  expect(s.onError).not.toHaveBeenCalled();
});
it('reports an unexpected close while awaiting transcription rather than remaining stuck', async () => {
  const s = setup();
  await flush();
  Socket.last.open();
  const ink = await s.pending;
  ink.finish();
  Socket.last.close();
  expect(s.onError).toHaveBeenCalledTimes(1);
  expect(s.onComplete).not.toHaveBeenCalled();
});
it('cancellation closes the socket and suppresses late transcripts', async () => {
  const s = setup();
  await flush();
  Socket.last.open();
  const ink = await s.pending;
  s.controller.abort();
  ink.send(new Float32Array([1]));
  Socket.last.message({ type: 'transcript', is_final: true, text: 'mute' });
  expect(Socket.last.sent).toHaveLength(0);
  expect(s.onTranscript).not.toHaveBeenCalled();
});
it('times out a transcription with no final response', async () => {
  const s = setup();
  await flush();
  Socket.last.open();
  const ink = await s.pending;
  ink.finish();
  await vi.advanceTimersByTimeAsync(5000);
  expect(s.onError).toHaveBeenCalledTimes(1);
  expect(Socket.last.readyState).toBe(3);
});
it('sends audio in ~100 ms frames and flushes the last partial frame before finalizing', async () => {
  const s = setup();
  await flush();
  Socket.last.open();
  const ink = await s.pending;
  for (let i = 0; i < 4; i++) ink.send(new Float32Array(960)); // 4 x 20 ms
  expect(Socket.last.sent).toHaveLength(0);
  ink.send(new Float32Array(960)); // 100 ms reached
  expect(Socket.last.sent).toHaveLength(1);
  expect((Socket.last.sent[0] as ArrayBuffer).byteLength).toBe(4800 * 2);
  ink.send(new Float32Array(960));
  ink.finish();
  expect((Socket.last.sent[1] as ArrayBuffer).byteLength).toBe(960 * 2);
  expect(Socket.last.sent[2]).toBe('finalize');
});
it('asks Ink to favor the keyterms and leaves out the ink-whisper-only language option', async () => {
  const s = setup(['repeat that', 'Oxford Street']);
  await flush();
  Socket.last.open();
  await s.pending;
  expect(Socket.last.url).toContain('keyterm=repeat%20that&keyterm=Oxford%20Street');
  expect(new URL(Socket.last.url).searchParams.has('language')).toBe(false);
});
it('keeps keyterms within Ink-2 limits', () => {
  const many = Array.from({ length: 150 }, (_, i) => `term${i}`);
  expect(inkQuery({}, many).split('&')).toHaveLength(MAX_KEYTERMS);
  const long = Array.from({ length: 30 }, () => 'x'.repeat(50));
  expect(inkQuery({}, long).split('&')).toHaveLength(24);
});
