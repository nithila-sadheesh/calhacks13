// Rohit's arbiter (STUB). Will turn `mapCue` and `webcamAlert` into at most one `speak` at a
// time, applying the rules table in docs/DESIGN.md (priority, preemption, expiry, duplicates,
// coalescing, spacing, mute, repeat, camera down, reset) and logging each `arbiterDecision`.
// Put the rules in pure functions beside this file so they can be unit-tested.
// Publishes: speak, arbiterDecision.
import { log } from '../../../shared/log.ts';
import type { AppModule } from '../../../shared/types.ts';

export const arbiterModule: AppModule = {
  name: 'arbiter',
  async start() {
    log('arbiter', 'started');
  },
  stop() {},
};
