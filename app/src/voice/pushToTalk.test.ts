import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import { createPushToTalk } from './pushToTalk.ts';
import type { openCapture } from './capture.ts';
import type { openInk } from './ink.ts';
function setup() {
  const bus = createBus();
  const status = vi.fn();
  const commands = vi.fn();
  const sent = vi.fn();
  bus.on('voiceCommand', commands);
  bus.on('dataSent', sent);
  let samples!: (samples: Float32Array) => void;
  let callbacks!: Parameters<typeof openInk>[0];
  const stop = vi.fn();
  const send = vi.fn();
  const finish = vi.fn();
  const cancel = vi.fn();
  const capture = vi.fn<typeof openCapture>().mockImplementation(async (cb) => {
    samples = cb;
    return { sampleRate: 48000, stop };
  });
  const ink = vi.fn<typeof openInk>().mockImplementation(async (options) => {
    callbacks = options;
    return { send, finish, cancel };
  });
  const mic = createPushToTalk({
    bus,
    clock: { nowMs: () => 123, onReset: () => () => {} },
    status,
    capture,
    ink,
  });
  return {
    mic,
    status,
    commands,
    sent,
    stop,
    send,
    finish,
    cancel,
    capture,
    ink,
    samples: (s: Float32Array) => samples(s),
    callbacks: () => callbacks,
  };
}
describe('push-to-talk privacy and lifecycle', () => {
  it('streams only while held and emits a command only after the final utterance completes', async () => {
    const s = setup();
    await s.mic.press();
    s.samples(new Float32Array(4800));
    s.callbacks().onTranscript('repeat');
    expect(s.commands).not.toHaveBeenCalled();
    s.mic.release();
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.finish).toHaveBeenCalledTimes(1);
    s.samples(new Float32Array(4800));
    expect(s.send).toHaveBeenCalledTimes(1);
    s.callbacks().onTranscript('that');
    s.callbacks().onComplete();
    expect(s.commands).toHaveBeenCalledWith({ kind: 'repeat', transcript: 'repeat that' });
    expect(s.sent).toHaveBeenCalledWith({
      destination: 'cartesia-stt',
      summary: 'mic audio, 0.10 s',
      tripMs: 123,
    });
    s.callbacks().onComplete();
    expect(s.commands).toHaveBeenCalledTimes(1);
  });
  it.each(['mute', 'unmute'])(
    'recognizes %s without confusing mute and unmute',
    async (command) => {
      const s = setup();
      await s.mic.press();
      s.mic.release();
      s.callbacks().onTranscript(command);
      s.callbacks().onComplete();
      expect(s.commands).toHaveBeenCalledWith({ kind: command, transcript: command });
    },
  );
  it('ignores unsupported speech, even if it contains a command word', async () => {
    const s = setup();
    await s.mic.press();
    s.mic.release();
    s.callbacks().onTranscript('do not mute');
    s.callbacks().onComplete();
    expect(s.commands).not.toHaveBeenCalled();
    expect(s.status).toHaveBeenLastCalledWith('idle');
  });
  it('cleans up permission granted after an early release without opening Ink', async () => {
    const s = setup();
    let grant!: (value: { sampleRate: number; stop: () => void }) => void;
    s.capture.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const pending = s.mic.press();
    s.mic.release();
    grant({ sampleRate: 48000, stop: s.stop });
    await pending;
    expect(s.stop).toHaveBeenCalled();
    expect(s.ink).not.toHaveBeenCalled();
    expect(s.send).not.toHaveBeenCalled();
  });
  it('cancels a connection opening after release and ignores all stale transcripts', async () => {
    const s = setup();
    let connect!: (value: {
      send: typeof s.send;
      finish: typeof s.finish;
      cancel: typeof s.cancel;
    }) => void;
    s.ink.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          connect = resolve;
        }),
    );
    const pending = s.mic.press();
    await Promise.resolve();
    await Promise.resolve();
    s.mic.release();
    connect({ send: s.send, finish: s.finish, cancel: s.cancel });
    await pending;
    expect(s.cancel).toHaveBeenCalled();
    expect(s.finish).not.toHaveBeenCalled();
    expect(s.status).toHaveBeenLastCalledWith('idle');
  });
  it('reset cancels the microphone and prevents commands from the old session', async () => {
    const s = setup();
    await s.mic.press();
    const old = s.callbacks();
    s.samples(new Float32Array(480));
    s.mic.cancel();
    old.onTranscript('unmute');
    old.onComplete();
    expect(s.commands).not.toHaveBeenCalled();
    expect(s.stop).toHaveBeenCalled();
    expect(s.cancel).toHaveBeenCalled();
    expect(old.signal.aborted).toBe(true);
    expect(s.sent).toHaveBeenCalledTimes(1);
  });
  it('permission denial and Ink errors leave the microphone stopped', async () => {
    const s = setup();
    s.capture.mockRejectedValueOnce(new Error('denied'));
    await s.mic.press();
    expect(s.status).toHaveBeenLastCalledWith('error');
    await s.mic.press();
    s.callbacks().onError();
    expect(s.stop).toHaveBeenCalled();
    expect(s.status).toHaveBeenLastCalledWith('error');
  });
  it('starting again discards a prior unfinished transcription', async () => {
    const s = setup();
    await s.mic.press();
    s.mic.release();
    const old = s.callbacks();
    await s.mic.press();
    old.onTranscript('repeat that');
    old.onComplete();
    expect(s.commands).not.toHaveBeenCalled();
    s.mic.cancel();
  });
});
