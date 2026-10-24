import { afterEach, expect, it, vi } from 'vitest';
import { openCapture } from './capture.ts';
class Context {
  static last: Context;
  state = 'running';
  sampleRate = 48000;
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  audioWorklet = { addModule: vi.fn(async () => {}) };
  source = { connect: vi.fn(), disconnect: vi.fn() };
  createMediaStreamSource = vi.fn(() => this.source);
  constructor() {
    Context.last = this;
  }
}
class Worklet {
  static last: Worklet;
  port: {
    onmessage: ((event: { data: unknown }) => void) | null;
    close: ReturnType<typeof vi.fn>;
  } = { onmessage: null, close: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor() {
    Worklet.last = this;
  }
}
function setup() {
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('AudioWorkletNode', Worklet);
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const media = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media } });
  const controller = new AbortController();
  const samples = vi.fn();
  return { track, stream, media, controller, samples };
}
afterEach(() => vi.unstubAllGlobals());
it('stops tracks, nodes and messages immediately on release', async () => {
  const s = setup();
  const capture = await openCapture(s.samples, s.controller.signal);
  const callback = Worklet.last.port.onmessage!;
  callback({ data: new Float32Array([0]) });
  expect(s.samples).toHaveBeenCalledTimes(1);
  capture.stop();
  callback({ data: new Float32Array([0]) });
  expect(s.samples).toHaveBeenCalledTimes(1);
  expect(s.track.stop).toHaveBeenCalledTimes(1);
  expect(Worklet.last.port.close).toHaveBeenCalledTimes(1);
  expect(Context.last.source.disconnect).toHaveBeenCalledTimes(1);
});
it('stops a permission grant arriving after cancellation without building the audio graph', async () => {
  const s = setup();
  let grant!: (stream: typeof s.stream) => void;
  s.media.mockReturnValueOnce(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  const pending = openCapture(s.samples, s.controller.signal);
  s.controller.abort();
  grant(s.stream);
  await expect(pending).rejects.toThrow('Capture cancelled');
  expect(s.track.stop).toHaveBeenCalledTimes(1);
  expect(Context.last.createMediaStreamSource).not.toHaveBeenCalled();
});
it('cleans up tracks when loading the worklet fails', async () => {
  const s = setup();
  const pending = openCapture(s.samples, s.controller.signal);
  Context.last.audioWorklet.addModule.mockRejectedValueOnce(new Error('worklet unavailable'));
  await expect(pending).rejects.toThrow('worklet unavailable');
  expect(s.track.stop).toHaveBeenCalledTimes(1);
  expect(Context.last.close).toHaveBeenCalledTimes(1);
});
