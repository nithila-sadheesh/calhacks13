// Mock for Rohit's arbiter: no rules at all. Every map cue and vision alert becomes a speak
// request immediately and is logged as "spoken". Lets the other modules be tested alone.
import type { AppModule } from '../types.ts';

export function createMockArbiter(): AppModule {
  const offs: Array<() => void> = [];

  return {
    name: 'arbiter',
    async start({ bus, clock }) {
      offs.push(
        bus.on('mapCue', (cue) => {
          bus.emit('speak', {
            id: `speak-${cue.id}`,
            sourceId: cue.id,
            text: cue.text,
            priority: cue.priority,
            expiresMs: cue.expiresMs,
          });
          bus.emit('arbiterDecision', {
            sourceId: cue.id,
            action: 'spoken',
            reason: 'mock arbiter',
            tripMs: clock.nowMs(),
            speakId: `speak-${cue.id}`,
          });
        }),
        bus.on('webcamAlert', (alert) => {
          bus.emit('speak', {
            id: `speak-${alert.id}`,
            sourceId: alert.id,
            text: alert.text,
            clipKey: alert.clipKey,
            priority: 0,
            expiresMs: alert.expiresMs,
          });
          bus.emit('arbiterDecision', {
            sourceId: alert.id,
            action: 'spoken',
            reason: 'mock arbiter',
            tripMs: clock.nowMs(),
            speakId: `speak-${alert.id}`,
          });
        }),
      );
    },
    stop() {
      offs.splice(0).forEach((off) => off());
    },
  };
}
