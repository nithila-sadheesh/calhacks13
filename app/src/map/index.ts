// Jeev's map module (STUB). Will interpolate track.json at clock.nowMs(), emit `position` at
// ~10 Hz, project onto the route, and emit one `mapCue` per feature inside its timing window.
// Publishes: position, mapCue. See docs/DESIGN.md, "Jeev: route, map cues and drive fixtures".
import { log } from '../../../shared/log.ts';
import type { AppModule } from '../../../shared/types.ts';

export const mapModule: AppModule = {
  name: 'map',
  async start(ctx) {
    log('map', `started with ${ctx.fixtures.features.length} features`);
  },
  stop() {},
};
