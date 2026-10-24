// The live trip clock. Trip time starts at 0 when the trip is started and runs on wall time
// (performance.now), since a camera stream has no timeline of its own. It freezes when the trip
// ends. There is no seeking, so tripReset is published only when a new trip starts.
// `pause` and `play` on the <video> (iOS pauses it when the page is hidden) map to tripState so
// nothing is spoken over a frozen camera; trip time keeps running, as it does on the road.
import type { Bus, Events, TripClock } from '../../../shared/types.ts';

export type LiveVideo = Pick<
  HTMLVideoElement,
  'paused' | 'addEventListener' | 'removeEventListener'
>;

export function createLive(
  video: LiveVideo,
  bus: Bus,
  now: () => number = () => performance.now(),
) {
  const resetCallbacks = new Set<(tripMs: number) => void>();
  let startedAt: number | undefined;
  let endedAt: number | undefined;

  const nowMs = () => {
    if (startedAt === undefined) return 0;
    return (endedAt ?? now()) - startedAt;
  };
  const state = (): Events['tripState']['state'] => {
    if (startedAt === undefined) return 'idle';
    if (endedAt !== undefined) return 'ended';
    return video.paused ? 'paused' : 'playing';
  };
  const running = () => startedAt !== undefined && endedAt === undefined;

  const listeners: Array<[string, () => void]> = [
    ['play', () => running() && bus.emit('tripState', { state: 'playing' })],
    ['pause', () => running() && bus.emit('tripState', { state: 'paused' })],
  ];
  listeners.forEach(([event, handler]) => video.addEventListener(event, handler));

  const clock: TripClock = {
    nowMs,
    onReset(cb) {
      resetCallbacks.add(cb);
      return () => resetCallbacks.delete(cb);
    },
  };

  return {
    clock,
    announce() {
      bus.emit('tripState', { state: state() });
    },
    // Starts a new trip at 0. A trip that already ran is cleared first, as a seek would.
    start() {
      const restarting = startedAt !== undefined;
      startedAt = now();
      endedAt = undefined;
      if (restarting) {
        resetCallbacks.forEach((cb) => cb(0));
        bus.emit('tripReset', { tripMs: 0 });
      }
      bus.emit('tripState', { state: state() });
    },
    end() {
      if (!running()) return;
      endedAt = now();
      bus.emit('tripState', { state: 'ended' });
    },
    dispose() {
      listeners.forEach(([event, handler]) => video.removeEventListener(event, handler));
      resetCallbacks.clear();
    },
  };
}
