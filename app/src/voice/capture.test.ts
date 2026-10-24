import { afterEach, expect, it, vi } from 'vitest';
import { disposeCapture, openCapture, prepareCapture } from './capture.ts';
class Context {
  static last: Context;
  state = 'running';
  sampleRate = 48000;
  destination = {};
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  static failLoad = false;
  audioWorklet = {
    addModule: vi.fn(async () => {
      if (Context.failLoad) throw new Error('worklet unavailable');
    }),
  };
  source = { connect: vi.fn(), disconnect: vi.fn() };
  createMediaStreamSource = vi.fn(() => this.source);
  constructor() {
    Context.last = this;
    Context.created++;
  }
  static created = 0;
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
afterEach(() => {
  disposeCapture();
  vi.unstubAllGlobals();
});
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
it('cleans up tracks when loading the worklet fails, and starts over on the next tap', async () => {
  const s = setup();
  Context.created = 0;
  Context.failLoad = true;
  await expect(openCapture(s.samples, s.controller.signal)).rejects.toThrow('worklet unavailable');
  expect(s.track.stop).toHaveBeenCalledTimes(1);
  expect(Context.last.close).toHaveBeenCalledTimes(1);
  Context.failLoad = false;
  const capture = await openCapture(s.samples, new AbortController().signal);
  expect(Context.created).toBe(2);
  capture.stop();
});
it('keeps one context with the worklet loaded across taps, suspended in between', async () => {
  const s = setup();
  Context.created = 0;
  prepareCapture();
  const context = Context.last;
  expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(1);
  const first = await openCapture(s.samples, s.controller.signal);
  first.stop();
  expect(context.suspend).toHaveBeenCalledTimes(1);
  expect(context.close).not.toHaveBeenCalled();
  const second = await openCapture(s.samples, new AbortController().signal);
  expect(Context.created).toBe(1);
  expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(1);
  expect(context.resume).toHaveBeenCalledTimes(2);
  second.stop();
});
