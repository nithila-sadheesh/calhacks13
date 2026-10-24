// Mock for Jeev's map module: a fixed position at ~10 Hz and one stop-sign cue once the
// clock passes 3 s. Scripted on purpose; real map code must never hardcode times.
import type { AppModule } from '../types.ts';

export function createMockMap(): AppModule {
  let timer: ReturnType<typeof setInterval> | undefined;
  let offReset: (() => void) | undefined;

  return {
    name: 'map',
    async start({ bus, clock }) {
      let fired = false;
      offReset = clock.onReset(() => (fired = false));
      timer = setInterval(() => {
        const tripMs = clock.nowMs();
        bus.emit('position', { tripMs, lat: 37.8716, lon: -122.2727, speedMps: 9, headingDeg: 90 });
        if (!fired && tripMs >= 3000) {
          fired = true;
          bus.emit('mapCue', {
            id: 'mock-cue-1',
            featureId: 'mock-stop-1',
            featureKind: 'stopSign',
            text: 'Stop sign ahead. Prepare for a complete stop.',
            reason: 'mock: stop sign 74 m ahead at 9 m/s',
            priority: 1,
            earliestMs: tripMs,
            expiresMs: tripMs + 3000,
          });
        }
      }, 100);
    },
    stop() {
      clearInterval(timer);
      offReset?.();
    },
  };
}
