// Mock for Nithila's voice module: logs every speak request and fakes speechStarted /
// speechEnded after a duration estimated at 14 characters per second. Priority 0 cuts off
// whatever is "playing", like the real interruption.
import { log } from '../log.ts';
import type { AppModule } from '../types.ts';

export function createMockVoice(): AppModule {
  let offSpeak: (() => void) | undefined;
  let offReset: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    name: 'voice',
    async start({ bus, clock }) {
      let playingId: string | undefined;
      const finish = (interrupted: boolean) => {
        clearTimeout(timer);
        if (playingId) bus.emit('speechEnded', { id: playingId, interrupted });
        playingId = undefined;
      };

      offSpeak = bus.on('speak', (req) => {
        log('voice-mock', 'speak', req);
        if (playingId && req.priority === 0) finish(true);
        playingId = req.id;
        bus.emit('speechStarted', { id: req.id, firstAudibleMs: 250 });
        bus.emit('dataSent', {
          destination: 'cartesia-tts',
          summary: `text: "${req.text}"`,
          tripMs: clock.nowMs(),
        });
        timer = setTimeout(() => finish(false), (req.text.length / 14) * 1000);
      });
      offReset = clock.onReset(() => finish(true));
    },
    stop() {
      offSpeak?.();
      offReset?.();
      clearTimeout(timer);
    },
  };
}
