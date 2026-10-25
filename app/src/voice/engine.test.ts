import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import type { SpeakRequest } from '../../../shared/types.ts';
import { createVoiceEngine } from './engine.ts';
import { CLIP_TEXT, type ClipKey } from './config.ts';
import type { AudioPlayer } from './player.ts';
import type { SonicMessage } from './sonic.ts';

const route = 'Stop sign ahead. Prepare for a complete stop.';
function setup() {
  vi.useFakeTimers();
  let tripMs = 0;
  let ready = true;
  const bus = createBus();
  const ended = vi.fn();
  const started = vi.fn();
  bus.on('speechEnded', ended);
  bus.on('speechStarted', started);
  const nodes: Array<{
    stop: ReturnType<typeof vi.fn>;
    start: (audibleAt?: number) => void;
    end: () => void;
  }> = [];
  const player: AudioPlayer = {
    ready: () => ready,
    enable: async () => {},
    close: vi.fn(),
    play: vi.fn((_samples, start, end) => {
      const node = { stop: vi.fn(), start, end };
      nodes.push(node);
      return node;
    }),
  };
  const send = vi.fn().mockResolvedValue(undefined);
  const cancel = vi.fn();
  const close = vi.fn();
  let receive!: (m: SonicMessage) => void;
  let disconnect!: () => void;
  const clips = new Map<ClipKey, Float32Array>(
    Object.keys(CLIP_TEXT).map((key) => [key as ClipKey, new Float32Array([0.2])]),
  );
  const engine = createVoiceEngine({
    bus,
    clock: { nowMs: () => tripMs, onReset: () => () => {} },
    player,
    clips,
    latencyNow: () => performance.now(),
    transport: (r, d) => {
      receive = r;
      disconnect = d;
      return { warm: () => {}, send, cancel, close };
    },
  });
  const speak = (id = 'route', extra: Partial<SpeakRequest> = {}) =>
    engine.speak({ id, sourceId: id, priority: 1, text: route, ...extra });
  const context = () => String(send.mock.calls.at(-1)?.[0]);
  return {
    engine,
    speak,
    receive,
    disconnect,
    nodes,
    send,
    cancel,
    close,
    ended,
    started,
    context,
    clips,
    player,
    setTrip: (value: number) => {
      tripMs = value;
    },
    setReady: (value: boolean) => {
      ready = value;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});
describe('voice playback and fallback', () => {
  it('emits start only when playback starts, and ends after the last buffer', () => {
    const s = setup();
    s.speak();
    s.receive({ id: s.context(), type: 'chunk', samples: new Float32Array([0]) });
    expect(s.started).not.toHaveBeenCalled();
    s.nodes[0]!.start();
    s.nodes[0]!.start();
    expect(s.started).toHaveBeenCalledTimes(1);
    s.receive({ id: s.context(), type: 'done' });
    expect(s.ended).not.toHaveBeenCalled();
    s.nodes[0]!.end();
    expect(s.ended).toHaveBeenCalledWith({ id: 'route', interrupted: false });
  });
  it('measures latency from request receipt to the output timestamp, not chunk arrival', () => {
    const s = setup();
    s.speak();
    vi.advanceTimersByTime(100);
    s.receive({ id: s.context(), type: 'chunk', samples: new Float32Array([0]) });
    expect(s.started).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    s.nodes[0]!.start(175);
    expect(s.started).toHaveBeenCalledWith({ id: 'route', firstAudibleMs: 175 });
  });
  it('does not replay a fallback when the last audio buffer ends before server done', () => {
    const s = setup();
    s.speak();
    s.receive({ id: s.context(), type: 'chunk', samples: new Float32Array([0]) });
    s.nodes[0]!.start();
    s.nodes[0]!.end();
    s.receive({ id: s.context(), type: 'done' });
    expect(s.nodes).toHaveLength(1);
    expect(s.ended).toHaveBeenCalledTimes(1);
  });
  it('does not let empty chunks postpone the first-audio timeout', () => {
    const s = setup();
    s.speak();
    vi.advanceTimersByTime(1000);
    s.receive({ id: s.context(), type: 'chunk', samples: new Float32Array() });
    vi.advanceTimersByTime(500);
    expect(s.nodes).toHaveLength(1);
  });
  it('stops every queued buffer, cancels remotely and discards late chunks before a warning', () => {
    const s = setup();
    s.speak();
    const old = s.context();
    for (let i = 0; i < 3; i++)
      s.receive({ id: old, type: 'chunk', samples: new Float32Array([0]) });
    s.speak('alert', {
      priority: 0,
      clipKey: 'pedestrianNearby',
      text: CLIP_TEXT.pedestrianNearby,
    });
    expect(s.ended).toHaveBeenCalledWith({ id: 'route', interrupted: true });
    expect(s.cancel).toHaveBeenCalledWith(old);
    s.nodes.slice(0, 3).forEach((node) => expect(node.stop).toHaveBeenCalledTimes(1));
    expect(s.nodes).toHaveLength(4);
    s.receive({ id: old, type: 'chunk', samples: new Float32Array([0]) });
    s.receive({ id: old, type: 'done' });
    expect(s.nodes).toHaveLength(4);
    s.nodes[3]!.start();
    s.nodes[3]!.end();
    expect(s.ended).toHaveBeenLastCalledWith({ id: 'alert', interrupted: false });
  });
  it('falls back after 1.5 seconds including connection time, and ignores delayed streaming', () => {
    const s = setup();
    s.speak();
    const old = s.context();
    vi.advanceTimersByTime(1499);
    expect(s.nodes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(s.nodes).toHaveLength(1);
    expect(s.cancel).toHaveBeenCalledWith(old);
    s.receive({ id: old, type: 'chunk', samples: new Float32Array([0]) });
    expect(s.nodes).toHaveLength(1);
  });
  it('falls back on disconnect and stops queued streaming buffers', () => {
    const s = setup();
    s.speak();
    s.receive({ id: s.context(), type: 'chunk', samples: new Float32Array([0]) });
    s.disconnect();
    expect(s.nodes[0]!.stop).toHaveBeenCalled();
    expect(s.nodes).toHaveLength(2);
  });
  it('falls back on send failure', async () => {
    const s = setup();
    s.send.mockRejectedValueOnce(new Error('offline'));
    s.speak();
    await Promise.resolve();
    expect(s.nodes).toHaveLength(1);
  });
  it('ends without speech if no matching fallback exists', () => {
    const s = setup();
    s.speak('light', { text: 'Traffic light ahead. Be ready to stop.' });
    vi.advanceTimersByTime(1500);
    expect(s.nodes).toHaveLength(0);
    expect(s.ended).toHaveBeenCalledWith({ id: 'light', interrupted: false });
  });
  it('does not stream a priority-zero warning when its local clip is missing', () => {
    const s = setup();
    s.clips.clear();
    s.speak('alert', {
      priority: 0,
      text: CLIP_TEXT.pedestrianNearby,
      clipKey: 'pedestrianNearby',
    });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.ended).toHaveBeenCalledWith({ id: 'alert', interrupted: false });
  });
  it('prevents expired fallback and rejects unknown wording', () => {
    const s = setup();
    s.speak('expired', { expiresMs: 100 });
    s.setTrip(200);
    vi.advanceTimersByTime(1500);
    expect(s.nodes).toHaveLength(0);
    s.speak('unsafe', { text: 'Go now' });
    expect(s.send).toHaveBeenCalledTimes(1);
  });
  it('reset stops audio and timers; stale callbacks cannot affect the next request', () => {
    const s = setup();
    s.speak();
    const old = s.context();
    s.receive({ id: old, type: 'chunk', samples: new Float32Array([0]) });
    s.engine.reset();
    s.speak('new');
    s.nodes[0]!.start();
    s.nodes[0]!.end();
    s.receive({ id: old, type: 'done' });
    expect(s.started).not.toHaveBeenCalled();
    expect(s.ended).toHaveBeenCalledTimes(1);
    s.engine.stop();
    vi.advanceTimersByTime(10000);
    expect(s.close).toHaveBeenCalled();
    expect(s.nodes).toHaveLength(1);
  });
  it('protects priority-zero audio from other requests', () => {
    const s = setup();
    s.speak('alert', { priority: 0, text: CLIP_TEXT.pedestrianNearby });
    s.speak('route');
    s.speak('alert2', { priority: 0, text: CLIP_TEXT.pedestrianNearby });
    expect(s.nodes[0]!.stop).not.toHaveBeenCalled();
    expect(s.nodes).toHaveLength(1);
  });
  it('ends gracefully while browser sound is locked', () => {
    const s = setup();
    s.setReady(false);
    s.speak();
    expect(s.send).not.toHaveBeenCalled();
    expect(s.ended).toHaveBeenCalledWith({ id: 'route', interrupted: false });
  });
});

it('uses the explicit fallback key only when it matches the approved sentence', () => {
  const s = setup();
  s.speak('correct', { fallbackClipKey: 'stopSign' });
  vi.advanceTimersByTime(1500);
  expect(s.nodes).toHaveLength(1);
  s.engine.reset();
  s.speak('wrong', { fallbackClipKey: 'turn' });
  vi.advanceTimersByTime(1500);
  expect(s.nodes).toHaveLength(1);
  expect(s.ended).toHaveBeenCalledWith({ id: 'wrong', interrupted: false });
  s.engine.stop();
});
describe('generated wording', () => {
  const claude = 'Stop sign on Oxford Street. Plan a complete stop.';
  it('streams a safe generated line through Sonic', () => {
    const s = setup();
    s.speak('answer', { text: 'The stop sign is about 60 meters ahead.' });
    expect(s.send).toHaveBeenCalledWith(
      expect.any(String),
      'The stop sign is about 60 meters ahead.',
      undefined,
    );
  });
  it("streams a generated line with Claude's delivery", () => {
    const s = setup();
    const delivery = { emotion: 'sympathetic', pace: 'slower' } as const;
    s.speak('answer', { text: "That's completely normal.", delivery });
    expect(s.send).toHaveBeenCalledWith(expect.any(String), "That's completely normal.", delivery);
  });
  it('refuses an unsafe line without sending it', () => {
    const s = setup();
    s.speak('answer', { text: 'The intersection is clear.' });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.ended).toHaveBeenCalledWith({ id: 'answer', interrupted: false });
  });
  it('falls back to the route clip the arbiter chose when streaming is slow', () => {
    const s = setup();
    s.speak('cue', { text: claude, fallbackClipKey: 'stopSign' });
    vi.advanceTimersByTime(1500);
    expect(s.player.play).toHaveBeenCalledWith(
      s.clips.get('stopSign'),
      expect.any(Function),
      expect.any(Function),
    );
  });
  it('never lets generated text select a warning clip', () => {
    const s = setup();
    s.speak('cue', { text: claude, fallbackClipKey: 'pedestrianNearby' });
    vi.advanceTimersByTime(1500);
    expect(s.player.play).not.toHaveBeenCalled();
    expect(s.ended).toHaveBeenCalledWith({ id: 'cue', interrupted: false });
  });
});
