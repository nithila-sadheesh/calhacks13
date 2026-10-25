// Mock video coaching (legacy local warning available for regression tests): reports camera ok and emits one pedestrian alert once the
// clock passes 5 s. Scripted on purpose; real vision alerts must come from detections.
import type { AppModule } from '../types.ts';

export function createMockVision(options: { legacy?: boolean } = {}): AppModule {
  let timer: ReturnType<typeof setInterval> | undefined;
  let offReset: (() => void) | undefined;

  return {
    name: 'vision',
    async start({ bus, clock }) {
      let fired = false;
      bus.emit('cameraHealth', { ok: true });
      offReset = clock.onReset(() => (fired = false));
      timer = setInterval(() => {
        const tripMs = clock.nowMs();
        if (fired || tripMs < 5000) return;
        fired = true;
        if (!options.legacy) {
          bus.emit('visionAdvice', {
            id: 'mock-advice-1',
            text: 'Scan curb edges for pedestrians.',
            reason: 'mock: recent frames show pedestrians beside the road',
            tripMs,
            expiresMs: tripMs + 10000,
          });
          return;
        }
        bus.emit('webcamAlert', {
          id: 'mock-alert-1',
          kind: 'pedestrianNearby',
          text: 'Pedestrian ahead. Stay alert.',
          reason: 'mock: person, conf 0.81, 4 of 5 frames, center region',
          confidence: 0.81,
          tripMs,
          expiresMs: tripMs + 1500,
          clipKey: 'pedestrianNearby',
        });
      }, 100);
    },
    stop() {
      clearInterval(timer);
      offReset?.();
    },
  };
}
