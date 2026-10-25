// Rohit's arbiter. Turns `mapCue` and `webcamAlert` into at most one `speak` at a time using the
// pure rules in rules.ts, and logs every `arbiterDecision`. This file only wires the bus and the
// clock to step(). Publishes: speak, arbiterDecision.
import { log } from '../../../shared/log.ts';
import type { AppModule, Bus } from '../../../shared/types.ts';
import { type ArbiterState, type Effect, type Input, initialState, step } from './rules.ts';

const TICK_MS = 100;

export function createArbiter(options: { mapReminders?: boolean } = {}): AppModule {
  let offs: Array<() => void> = [];
  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    name: 'arbiter',
    async start({ bus, clock, video }) {
      let state: ArbiterState = initialState(!video.paused && !video.ended);
      // The bus is synchronous: emitting `speak` can make voice emit `speechEnded` before this
      // step has finished. Inputs that arrive mid-step wait in the inbox and run in order after.
      const inbox: Input[] = [];
      let busy = false;
      const dispatch = (input: Input) => {
        inbox.push(input);
        if (busy) return;
        busy = true;
        try {
          for (let next = inbox.shift(); next; next = inbox.shift()) {
            const out = step(state, next, clock.nowMs());
            state = out.state;
            out.effects.forEach((effect) => apply(bus, effect));
          }
        } finally {
          busy = false;
        }
      };

      offs = [
        bus.on('mapCue', (cue) => {
          if (options.mapReminders !== false) dispatch({ type: 'cue', cue });
          else
            bus.emit('arbiterDecision', {
              sourceId: cue.id,
              action: 'dropped',
              reason: 'video-led mode: map shown for context only',
              tripMs: clock.nowMs(),
            });
        }),
        bus.on('visionAdvice', (advice) => dispatch({ type: 'advice', advice })),
        bus.on('webcamAlert', (alert) => dispatch({ type: 'alert', alert })),
        bus.on('speechEnded', ({ id }) => dispatch({ type: 'speechEnded', id })),
        bus.on('voiceCommand', ({ kind }) => dispatch({ type: 'voice', kind })),
        bus.on('assistantReply', (reply) => dispatch({ type: 'answer', reply })),
        bus.on('cueWording', (wording) => dispatch({ type: 'cueWording', wording })),
        bus.on('cameraHealth', ({ ok }) => dispatch({ type: 'camera', ok })),
        bus.on('tripState', ({ state: s }) => dispatch({ type: 'tripState', state: s })),
        bus.on('tripReset', () => dispatch({ type: 'reset' })),
      ];
      timer = setInterval(() => dispatch({ type: 'tick' }), TICK_MS);
      log('arbiter', 'started');
    },
    stop() {
      clearInterval(timer);
      offs.splice(0).forEach((off) => off());
    },
  };
}

function apply(bus: Bus, effect: Effect) {
  if (effect.type === 'speak') bus.emit('speak', effect.request);
  else if (effect.type === 'decision') bus.emit('arbiterDecision', effect.decision);
  else log('arbiter', effect.message, effect.data);
}

export const arbiterModule = createArbiter();
