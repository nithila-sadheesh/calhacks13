import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
it('batches mono microphone samples into short PCM frames without monitoring audio', async () => {
  const postMessage = vi.fn();
  let Processor!: new () => { process(inputs: Float32Array[][]): boolean };
  class Base {
    port = { postMessage };
  }
  const code = await readFile(new URL('./captureWorklet.js', import.meta.url), 'utf8');
  runInNewContext(code, {
    AudioWorkletProcessor: Base,
    sampleRate: 48000,
    Float32Array,
    registerProcessor: (_name: string, implementation: typeof Processor) => {
      Processor = implementation;
    },
  });
  const processor = new Processor();
  expect(processor.process([])).toBe(true);
  for (let i = 0; i < 15; i++) processor.process([[new Float32Array(128).fill(0.25)]]);
  expect(postMessage).toHaveBeenCalledTimes(2);
  const samples = postMessage.mock.calls[0]?.[0] as Float32Array;
  expect(samples).toHaveLength(960);
  expect(samples[0]).toBe(0.25);
});
