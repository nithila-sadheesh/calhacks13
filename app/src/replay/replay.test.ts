import { describe, expect, it } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import type { EventName } from '../../../shared/types.ts';
import { createReplay, currentState } from './replay.ts';

class FakeVideo extends EventTarget {
  currentTime = 0;
  paused = true;
  ended = false;
  playbackRate = 1;
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

function setup() {
  const video = new FakeVideo();
  const bus = createBus();
  const seen: Array<[EventName, unknown]> = [];
  bus.onAny((type, payload) => seen.push([type, payload]));
  const replay = createReplay(video as unknown as HTMLVideoElement, bus);
  return { video, bus, seen, replay };
}

describe('replay clock', () => {
  it('reads trip time from the video', () => {
    const { video, replay } = setup();
    video.currentTime = 12.5;
    expect(replay.clock.nowMs()).toBe(12500);
  });

  it('maps play, pause and end to tripState', () => {
    const { video, seen } = setup();
    video.fire('play');
    video.fire('pause');
    video.ended = true;
    video.fire('pause');
    video.fire('ended');
    expect(seen).toEqual([
      ['tripState', { state: 'playing' }],
      ['tripState', { state: 'paused' }],
      ['tripState', { state: 'ended' }],
    ]);
  });

  it('runs reset callbacks before publishing tripReset on any seek', () => {
    const { video, replay, seen } = setup();
    const order: string[] = [];
    replay.clock.onReset((ms) => order.push(`cb ${ms} after ${seen.length} events`));
    video.currentTime = 4;
    video.fire('seeked');
    video.currentTime = 0;
    video.fire('seeked');
    expect(order).toEqual(['cb 4000 after 0 events', 'cb 0 after 1 events']);
    expect(seen).toEqual([
      ['tripReset', { tripMs: 4000 }],
      ['tripReset', { tripMs: 0 }],
    ]);
  });

  it('locks playback to 1x', () => {
    const { video } = setup();
    video.playbackRate = 2;
    video.fire('ratechange');
    expect(video.playbackRate).toBe(1);
  });

  it('announce publishes the current state', () => {
    const { video, replay, seen } = setup();
    replay.announce();
    video.paused = false;
    replay.announce();
    expect(seen.map(([, p]) => p)).toEqual([{ state: 'idle' }, { state: 'playing' }]);
  });

  it('dispose removes listeners and reset callbacks', () => {
    const { video, replay, seen } = setup();
    let calls = 0;
    replay.clock.onReset(() => calls++);
    replay.dispose();
    video.fire('play');
    video.fire('seeked');
    expect(seen).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe('currentState', () => {
  const video = (v: Partial<FakeVideo>) => Object.assign(new FakeVideo(), v);
  it('distinguishes idle, paused, playing and ended', () => {
    expect(currentState(video({}))).toBe('idle');
    expect(currentState(video({ currentTime: 3 }))).toBe('paused');
    expect(currentState(video({ paused: false }))).toBe('playing');
    expect(currentState(video({ ended: true, paused: true }))).toBe('ended');
  });
});
