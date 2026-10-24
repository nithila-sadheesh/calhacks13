import { afterEach, expect, it, vi } from 'vitest';
import { createAudioPlayer } from './player.ts';
class Source {
  buffer: { duration: number } | undefined;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class Context {
  static last: Context;
  state = 'suspended';
  currentTime = 0;
  renderedTime = 0;
  destination = {};
  sources: Source[] = [];
  constructor() {
    Context.last = this;
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  getOutputTimestamp() {
    return { contextTime: this.renderedTime };
  }
  createBuffer(_channels: number, samples: number, rate: number) {
    return { duration: samples / rate, copyToChannel: vi.fn() };
  }
  createBufferSource() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  node = () => ({ connect: vi.fn() });
  param = () => ({ value: 0 });
  compressor = {
    ...this.node(),
    threshold: this.param(),
    knee: this.param(),
    ratio: this.param(),
    attack: this.param(),
    release: this.param(),
  };
  createDynamicsCompressor = () => this.compressor;
  createGain = () => ({ ...this.node(), gain: this.param() });
  createWaveShaper = () => ({ ...this.node(), curve: null, oversample: 'none' });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('schedules chunks back to back and emits start only when output reaches the buffer', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', Context);
  const player = createAudioPlayer();
  expect(player.ready()).toBe(false);
  await player.enable();
  expect(player.ready()).toBe(true);
  const start = vi.fn();
  const end = vi.fn();
  player.play(new Float32Array(2400), start, end);
  player.play(new Float32Array(2400), vi.fn(), vi.fn());
  const ctx = Context.last;
  expect(ctx.sources[0]!.start).toHaveBeenCalledWith(0.015);
  expect(ctx.sources[1]!.start.mock.calls[0]?.[0]).toBeCloseTo(0.115);
  vi.advanceTimersByTime(10);
  expect(start).not.toHaveBeenCalled();
  ctx.renderedTime = 0.02;
  vi.advanceTimersByTime(5);
  expect(start).toHaveBeenCalledTimes(1);
  ctx.sources[0]!.onended?.();
  expect(end).toHaveBeenCalledTimes(1);
  player.close();
});
it('stops all scheduled nodes and resets the queue so a warning starts immediately', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', Context);
  const player = createAudioPlayer();
  await player.enable();
  const start = vi.fn();
  const end = vi.fn();
  const a = player.play(new Float32Array(24000), start, end);
  const b = player.play(new Float32Array(24000), start, end);
  a.stop();
  b.stop();
  a.stop();
  player.play(new Float32Array(2400), vi.fn(), vi.fn());
  const ctx = Context.last;
  expect(ctx.sources[2]!.start).toHaveBeenCalledWith(0.015);
  expect(ctx.sources[0]!.stop).toHaveBeenCalledTimes(1);
  expect(ctx.sources[1]!.stop).toHaveBeenCalledTimes(1);
  ctx.renderedTime = 3;
  vi.advanceTimersByTime(10);
  expect(start).not.toHaveBeenCalled();
  expect(end).not.toHaveBeenCalled();
  player.close();
});

it('plays everything through the loudness chain, not straight to the speakers', () => {
  vi.stubGlobal('AudioContext', Context);
  const player = createAudioPlayer();
  player.play(
    new Float32Array(240),
    () => {},
    () => {},
  );
  const source = Context.last.sources[0]!;
  expect(source.connect).toHaveBeenCalledWith(Context.last.compressor);
  expect(source.connect).not.toHaveBeenCalledWith(Context.last.destination);
});
