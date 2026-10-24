// The replay clock. The shared <video> is the only time source: tripMs = currentTime x 1000.
// Publishes `tripState` on play/pause/end, and `tripReset` (plus onReset callbacks) on any seek.
// Playback is locked to 1x: the judged run is real time only.
import type { Bus, Events, TripClock } from '../../../shared/types.ts';

export type ReplayVideo = Pick<
  HTMLVideoElement,
  'currentTime' | 'paused' | 'ended' | 'playbackRate' | 'addEventListener' | 'removeEventListener'
>;

export function createReplay(video: ReplayVideo, bus: Bus) {
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
    ['ratechange', () => video.playbackRate !== 1 && (video.playbackRate = 1)],
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
    // Publishes the current state once, for modules that start after playback events happened.
    announce() {
      bus.emit('tripState', { state: currentState(video) });
    },
    dispose() {
      listeners.forEach(([event, handler]) => video.removeEventListener(event, handler));
      resetCallbacks.clear();
    },
  };
}

export function currentState(video: ReplayVideo): Events['tripState']['state'] {
  if (video.ended) return 'ended';
  if (!video.paused) return 'playing';
  return video.currentTime === 0 ? 'idle' : 'paused';
}
