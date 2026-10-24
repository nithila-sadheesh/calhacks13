import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSonicTransport } from './sonic.ts';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  sent: Array<Record<string, unknown>> = [];
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    Socket.instances.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(body: unknown) {
    this.onmessage?.({ data: JSON.stringify(body) });
  }
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function setup() {
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ token: 'temporary' }));
  vi.stubGlobal('fetch', fetcher);
  const receive = vi.fn();
  const disconnected = vi.fn();
  const sent = vi.fn();
  const transport = createSonicTransport(receive, disconnected, sent);
  return { transport, receive, disconnected, sent, fetcher };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Sonic session transport', () => {
  it('reuses one socket, decodes PCM, sends safe configuration and reports text only when sent', async () => {
    const s = setup();
    const pending = s.transport.send('one', 'Crosswalk ahead. Scan both sides.');
    await flush();
    const socket = Socket.instances[0]!;
    expect(s.sent).not.toHaveBeenCalled();
    socket.open();
    await pending;
    await s.transport.send('two', 'Turn ahead.');
    expect(Socket.instances).toHaveLength(1);
    expect(s.fetcher).toHaveBeenCalledTimes(1);
    expect(socket.sent[0]).toMatchObject({
      model_id: 'sonic-3.6',
      context_id: 'one',
      continue: false,
      max_buffer_delay_ms: 0,
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
    });
    socket.message({ type: 'chunk', context_id: 'one', data: 'AAA=' });
    expect(s.receive).toHaveBeenCalledWith({
      id: 'one',
      type: 'chunk',
      samples: new Float32Array([0]),
    });
    expect(s.sent).toHaveBeenCalledTimes(2);
    s.transport.close();
  });
  it('cancels a request before connection opens without sending its transcript', async () => {
    const s = setup();
    const pending = s.transport.send('old', 'Turn ahead.');
    s.transport.cancel('old');
    await flush();
    Socket.instances[0]!.open();
    await pending;
    expect(Socket.instances[0]!.sent).toHaveLength(0);
    expect(s.sent).not.toHaveBeenCalled();
    s.transport.close();
  });
  it('sends cancel and ignores chunks for the cancelled context', async () => {
    const s = setup();
    const pending = s.transport.send('old', 'Turn ahead.');
    await flush();
    const socket = Socket.instances[0]!;
    socket.open();
    await pending;
    s.transport.cancel('old');
    socket.message({ type: 'chunk', context_id: 'old', data: 'AAA=' });
    expect(socket.sent.at(-1)).toEqual({ context_id: 'old', cancel: true });
    expect(s.receive).not.toHaveBeenCalled();
    s.transport.close();
  });
  it('reconnects after a drop without replaying the interrupted request', async () => {
    const s = setup();
    const pending = s.transport.send('old', 'Turn ahead.');
    await flush();
    Socket.instances[0]!.open();
    await pending;
    Socket.instances[0]!.close();
    expect(s.disconnected).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    const replacement = Socket.instances[1]!;
    replacement.open();
    await flush();
    expect(replacement.sent).toHaveLength(0);
    await s.transport.send('new', 'Turn ahead.');
    expect(replacement.sent[0]?.context_id).toBe('new');
    s.transport.close();
    await vi.advanceTimersByTimeAsync(20000);
    expect(Socket.instances).toHaveLength(2);
  });
  it('times out a connection and does not expose the token in errors', async () => {
    const s = setup();
    const pending = s.transport.send('one', 'Turn ahead.');
    const check = expect(pending).rejects.toThrow('timed out');
    await flush();
    await vi.advanceTimersByTimeAsync(10000);
    await check;
    s.transport.close();
  });
});

it('warms the session without sending text and reuses it for the first line', async () => {
  const s = setup();
  const pending = s.transport.warmup!();
  await flush();
  const socket = Socket.instances[0]!;
  expect(socket.sent).toEqual([]);
  socket.open();
  await pending;
  await s.transport.send('first', 'Crosswalk ahead. Scan both sides.');
  expect(Socket.instances).toHaveLength(1);
  expect(s.fetcher).toHaveBeenCalledTimes(1);
  expect(s.sent).toHaveBeenCalledTimes(1);
  s.transport.close();
});
