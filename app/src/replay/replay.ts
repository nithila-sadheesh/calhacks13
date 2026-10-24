// The replay clock. The shared <video> is the only time source: tripMs = currentTime x 1000.
// Publishes `tripState` on play/pause/end, and `tripReset` (plus onReset callbacks) on any seek.
import type { Bus, TripClock } from '../../../shared/types.ts';

export function createReplay(video: HTMLVideoElement, bus: Bus) {
  const resetCallbacks = new Set<(tripMs: number) => void>();
  const nowMs = () => video.currentTime * 1000;

  const listeners: Array<[string, () => void]> = [
    ['play', () => bus.emit('tripState', { state: 'playing' })],
    ['pause', () => !video.ended && bus.emit('tripState', { state: 'paused' })],
    ['ended', () => bus.emit('tripState', { state: 'ended' })],
    [
      'seeked',
      () => {
        const tripMs = nowMs();
        resetCallbacks.forEach((cb) => cb(tripMs));
        bus.emit('tripReset', { tripMs });
      },
    ],
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
    dispose() {
      listeners.forEach(([event, handler]) => video.removeEventListener(event, handler));
      resetCallbacks.clear();
    },
  };
}
