import { describe, expect, it } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import type { EventName } from '../../../shared/types.ts';
import { createLive, type LiveVideo } from './live.ts';

function setup() {
  const handlers = new Map<string, () => void>();
  const video = {
    paused: true,
    addEventListener: (type: string, cb: () => void) => handlers.set(type, cb),
    removeEventListener: (type: string) => handlers.delete(type),
  } as unknown as LiveVideo & { paused: boolean };
  let wall = 1000;
  const bus = createBus();
  const events: Array<[EventName, unknown]> = [];
  bus.onAny((type, payload) => events.push([type, payload]));
  const live = createLive(video, bus, () => wall);
  const fire = (type: string) => handlers.get(type)?.();
  return {
    live,
    video,
    events,
    fire,
    handlers,
    advance: (ms: number) => (wall += ms),
  };
}

describe('live clock', () => {
  it('reads 0 and idle before the trip starts', () => {
    const { live, events } = setup();
    live.announce();
    expect(live.clock.nowMs()).toBe(0);
    expect(events).toEqual([['tripState', { state: 'idle' }]]);
  });

  it('counts wall time from start and freezes at end', () => {
    const { live, video, events, advance } = setup();
    video.paused = false;
    live.start();
    advance(2500);
    expect(live.clock.nowMs()).toBe(2500);
    live.end();
    advance(1000);
    expect(live.clock.nowMs()).toBe(2500);
    expect(events).toEqual([
      ['tripState', { state: 'playing' }],
      ['tripState', { state: 'ended' }],
    ]);
  });

  it('maps video pause and play to tripState only while the trip runs', () => {
    const { live, video, events, fire, advance } = setup();
    fire('pause');
    expect(events).toEqual([]);
    video.paused = false;
    live.start();
    fire('pause');
    advance(1000);
    fire('play');
    expect(live.clock.nowMs()).toBe(1000);
    live.end();
    fire('play');
    expect(events.map(([, p]) => p)).toEqual([
      { state: 'playing' },
      { state: 'paused' },
      { state: 'playing' },
      { state: 'ended' },
    ]);
  });

  it('a second start resets every module and restarts at 0', () => {
    const { live, video, events, advance } = setup();
    const resets: number[] = [];
    live.clock.onReset((ms) => resets.push(ms));
    video.paused = false;
    live.start();
    advance(5000);
    live.end();
    events.length = 0;
    live.start();
    expect(live.clock.nowMs()).toBe(0);
    expect(resets).toEqual([0]);
    expect(events).toEqual([
      ['tripReset', { tripMs: 0 }],
      ['tripState', { state: 'playing' }],
    ]);
  });

  it('dispose removes the video listeners', () => {
    const { live, handlers } = setup();
    live.dispose();
    expect(handlers.size).toBe(0);
  });
});
