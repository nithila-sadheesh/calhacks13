// Nithila's voice module (STUB). Will play `speak` requests through Cartesia Sonic (streamed) or
// bundled clips, interrupt locally on priority 0, and run Ink push-to-talk.
// Publishes: speechStarted, speechEnded, voiceCommand, dataSent.
// See docs/DESIGN.md, "Nithila: Cartesia voice, server and deploy".
import { log } from '../../../shared/log.ts';
import type { AppModule } from '../../../shared/types.ts';

export const voiceModule: AppModule = {
  name: 'voice',
  async start() {
    log('voice', 'started');
  },
  stop() {},
};
