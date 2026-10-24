import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import { createPushToTalk, END_OF_SPEECH_MS, LISTEN_MS } from './pushToTalk.ts';
import type { openCapture } from './capture.ts';
import type { openInk } from './ink.ts';

type InkHandle = Awaited<ReturnType<typeof openInk>>;

function setup() {
  const bus = createBus();
  const status = vi.fn();
  const commands = vi.fn();
  const queries = vi.fn();
  const sent = vi.fn();
  bus.on('voiceCommand', commands);
  bus.on('voiceQuery', queries);
  bus.on('dataSent', sent);
  let samples!: (samples: Float32Array) => void;
  let callbacks!: Parameters<typeof openInk>[0];
  const stop = vi.fn();
  const send = vi.fn();
  const finish = vi.fn();
  const cancel = vi.fn();
  const timers: Array<{ cb: () => void; ms: number; cleared: boolean }> = [];
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
    setTimer: (cb, ms) => {
      const timer = { cb, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (t) => {
      if (t) (t as { cleared: boolean }).cleared = true;
    },
  });
  // Fires the listening-window timer, if it is still armed.
  const expire = () => timers.filter((t) => !t.cleared).forEach((t) => t.cb());
  return {
    mic,
    status,
    commands,
    queries,
    sent,
    stop,
    send,
    finish,
    cancel,
    capture,
    ink,
    timers,
    expire,
    samples: (s: Float32Array) => samples(s),
    callbacks: () => callbacks,
  };
}

// Lets the capture and Ink promises inside start() resolve.
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('tap-to-talk', () => {
  it('fires the command as soon as Ink hears it, joining spaced segments', async () => {
    const s = setup();
    await s.mic.start();
    // Not "listening" until the microphone delivers audio: speech before that is lost.
    expect(s.status).toHaveBeenLastCalledWith('connecting');
    s.samples(new Float32Array(4800));
    expect(s.status).toHaveBeenLastCalledWith('listening');
    // Ink final segments carry their own leading space.
    s.callbacks().onTranscript(' repeat');
    expect(s.commands).toHaveBeenCalledWith({ kind: 'repeat', transcript: 'repeat' });
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.cancel).toHaveBeenCalled();
    expect(s.status).toHaveBeenLastCalledWith('idle');
    expect(s.sent).toHaveBeenCalledWith({
      destination: 'cartesia-stt',
      summary: 'mic audio, 0.10 s',
      tripMs: 123,
    });
    s.callbacks().onTranscript(' that.');
    s.callbacks().onComplete();
    expect(s.commands).toHaveBeenCalledTimes(1);
  });

  it('matches a command split across segments only once it is complete', async () => {
    const s = setup();
    await s.mic.start();
    s.callbacks().onTranscript(' can you');
    expect(s.commands).not.toHaveBeenCalled();
    s.callbacks().onTranscript(' say that again?');
    expect(s.commands).toHaveBeenCalledWith({
      kind: 'repeat',
      transcript: 'can you say that again?',
    });
  });

  it('keeps speech captured while Ink connects and sends it once Ink opens', async () => {
    const s = setup();
    let connect!: (handle: InkHandle) => void;
    s.ink.mockImplementationOnce(async () => new Promise<InkHandle>((r) => (connect = r)));
    const pending = s.mic.start();
    await settle();
    s.samples(new Float32Array(480));
    s.samples(new Float32Array(960));
    expect(s.send).not.toHaveBeenCalled();
    connect({ send: s.send, finish: s.finish, cancel: s.cancel });
    await pending;
    expect(s.send.mock.calls.map(([chunk]) => (chunk as Float32Array).length)).toEqual([480, 960]);
    s.samples(new Float32Array(240));
    expect(s.send).toHaveBeenCalledTimes(3);
  });

  it('finalizes after the listening window and acts on the completed utterance', async () => {
    const s = setup();
    await s.mic.start();
    expect(s.timers[0]?.ms).toBe(LISTEN_MS);
    s.expire();
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.finish).toHaveBeenCalledTimes(1);
    expect(s.status).toHaveBeenLastCalledWith('transcribing');
    s.samples(new Float32Array(480));
    expect(s.send).not.toHaveBeenCalled();
    s.callbacks().onTranscript(' Mute.');
    expect(s.commands).toHaveBeenCalledWith({ kind: 'mute', transcript: 'Mute.' });
  });

  it('a second tap stops listening early', async () => {
    const s = setup();
    await s.mic.start();
    s.mic.toggle();
    expect(s.finish).toHaveBeenCalledTimes(1);
    expect(s.timers[0]?.cleared).toBe(true);
    s.callbacks().onComplete();
    expect(s.status).toHaveBeenLastCalledWith('idle');
  });

  it('never runs a command hidden inside other speech; it becomes a question', async () => {
    const s = setup();
    await s.mic.start();
    s.callbacks().onTranscript(' do not mute');
    s.mic.finish();
    s.callbacks().onComplete();
    expect(s.commands).not.toHaveBeenCalled();
    expect(s.queries).toHaveBeenCalledWith({
      id: 'query-1',
      transcript: 'do not mute',
      tripMs: 123,
    });
    expect(s.status).toHaveBeenLastCalledWith('idle');
  });

  it('sends a question once the speaker pauses, waiting while they keep talking', async () => {
    const s = setup();
    await s.mic.start();
    s.callbacks().onTranscript(' how far is');
    const firstQuiet = s.timers.at(-1)!;
    expect(firstQuiet.ms).toBe(END_OF_SPEECH_MS);
    s.callbacks().onTranscript(' the stop sign?');
    expect(firstQuiet.cleared).toBe(true);
    s.timers.at(-1)!.cb();
    expect(s.finish).toHaveBeenCalledTimes(1);
    s.callbacks().onComplete();
    expect(s.queries).toHaveBeenCalledWith({
      id: 'query-1',
      transcript: 'how far is the stop sign?',
      tripMs: 123,
    });
  });

  it('sends nothing when nothing was said', async () => {
    const s = setup();
    await s.mic.start();
    s.expire();
    s.callbacks().onComplete();
    expect(s.queries).not.toHaveBeenCalled();
    expect(s.commands).not.toHaveBeenCalled();
  });

  it('a window that ends while Ink connects still finalizes the buffered speech', async () => {
    const s = setup();
    let connect!: (handle: InkHandle) => void;
    s.ink.mockImplementationOnce(async () => new Promise<InkHandle>((r) => (connect = r)));
    const pending = s.mic.start();
    await settle();
    s.samples(new Float32Array(480));
    s.mic.toggle();
    expect(s.status).toHaveBeenLastCalledWith('transcribing');
    connect({ send: s.send, finish: s.finish, cancel: s.cancel });
    await pending;
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.finish).toHaveBeenCalledTimes(1);
    expect(s.sent).toHaveBeenCalledTimes(1);
  });

  it('stopping while the permission prompt is open never opens Ink', async () => {
    const s = setup();
    let grant!: (value: { sampleRate: number; stop: () => void }) => void;
    s.capture.mockImplementationOnce(async () => new Promise((resolve) => (grant = resolve)));
    const pending = s.mic.start();
    s.mic.toggle();
    grant({ sampleRate: 48000, stop: s.stop });
    await pending;
    expect(s.stop).toHaveBeenCalled();
    expect(s.ink).not.toHaveBeenCalled();
    expect(s.status).toHaveBeenLastCalledWith('idle');
  });

  it('cancel stops the microphone and ignores the old session', async () => {
    const s = setup();
    await s.mic.start();
    const old = s.callbacks();
    s.samples(new Float32Array(480));
    s.mic.cancel();
    old.onTranscript(' unmute');
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
    await s.mic.start();
    expect(s.status).toHaveBeenLastCalledWith('error');
    await s.mic.start();
    s.callbacks().onError();
    expect(s.stop).toHaveBeenCalled();
    expect(s.status).toHaveBeenLastCalledWith('error');
  });

  it('starting again discards a prior unfinished transcription', async () => {
    const s = setup();
    await s.mic.start();
    s.mic.finish();
    const old = s.callbacks();
    await s.mic.start();
    old.onTranscript(' repeat that');
    old.onComplete();
    expect(s.commands).not.toHaveBeenCalled();
    s.mic.cancel();
  });
});
