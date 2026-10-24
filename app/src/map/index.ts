// Jeev's map module. On each animation frame it reads clock.nowMs(); about every 100 ms of trip
// time it interpolates track.json, emits `position`, tracks progress along the route, and emits
// one `mapCue` per feature when its time to arrival enters the cue window. Clears on tripReset.
// Publishes: position, mapCue. See docs/DESIGN.md, "Jeev: route, map cues and drive fixtures".
import { log } from '../../../shared/log.ts';
import type { AppModule } from '../../../shared/types.ts';
import { createMapEngine, EMPTY_SNAPSHOT, type EngineStatus } from './engine.ts';
import { mapState } from './mapState.ts';

export const POSITION_INTERVAL_MS = 100;

export type FrameScheduler = {
  request(cb: () => void): number;
  cancel(id: number): void;
};

const animationFrames: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

export function createMapModule(frames: FrameScheduler = animationFrames): AppModule {
  let stopRunning: (() => void) | undefined;

  return {
    name: 'map',
    async start({ bus, clock, fixtures }) {
      stopRunning?.();
      const engine = createMapEngine(fixtures);
      log(
        'map',
        `started: ${fixtures.features.length} features, route ${Math.round(engine.routeLengthM)} m, ` +
          `${engine.trackPointCount} track points`,
      );

      let lastTripMs: number | undefined;
      let lastStatus: EngineStatus | undefined;
      let frameId: number | undefined;

      const tick = () => {
        frameId = frames.request(tick);
        const tripMs = clock.nowMs();
        // Paused: the clock stands still, so there is nothing new to emit.
        if (lastTripMs !== undefined && Math.abs(tripMs - lastTripMs) < POSITION_INTERVAL_MS)
          return;
        lastTripMs = tripMs;

        const { position, decisions, snapshot } = engine.update(tripMs);
        if (position) bus.emit('position', position);
        decisions.forEach(({ cue }) => bus.emit('mapCue', cue));
        if (snapshot.status !== lastStatus) {
          log('map', `route match: ${snapshot.status}`, { tripMs: Math.round(tripMs) });
          lastStatus = snapshot.status;
        }
        mapState.set(snapshot);
      };

      // Clear only; never emit from here. The arbiter clears its queue on the tripReset that
      // follows, so anything emitted now would be lost. The next frame re-matches the route.
      const offReset = clock.onReset(() => {
        engine.reset();
        lastTripMs = undefined;
        lastStatus = undefined;
        mapState.set(EMPTY_SNAPSHOT);
      });

      // First tick on the next frame, not inside start(): the other modules are still starting.
      frameId = frames.request(tick);

      stopRunning = () => {
        if (frameId !== undefined) frames.cancel(frameId);
        offReset();
        mapState.set(EMPTY_SNAPSHOT);
        stopRunning = undefined;
      };
    },
    stop() {
      stopRunning?.();
    },
  };
}

export const mapModule: AppModule = createMapModule();
