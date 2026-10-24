// Jeev's map module. Replay: on each animation frame it reads clock.nowMs(); about every 100 ms
// of trip time it interpolates track.json. Live: each device GPS fix (about 1 Hz on iOS) becomes
// the position. Either way it emits `position`, tracks progress along the route, and emits one
// `mapCue` per feature when its time to arrival enters the cue window. Clears on tripReset.
// Live location stays on the device: it is only matched against the saved route here.
// Publishes: position, mapCue. See docs/DESIGN.md, "Jeev: route, map cues and drive fixtures".
import { log } from '../../../shared/log.ts';
import type { AppModule, Events, Position } from '../../../shared/types.ts';
import { createMapEngine, EMPTY_SNAPSHOT, type EngineStatus, type EngineUpdate } from './engine.ts';
import { fixToPosition, toGpsFix } from './live.ts';
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

export type GeoSource = Pick<Geolocation, 'watchPosition' | 'clearWatch'>;

const deviceGeolocation = (): GeoSource | undefined =>
  typeof navigator !== 'undefined' ? navigator.geolocation : undefined;

export function createMapModule(
  frames: FrameScheduler = animationFrames,
  geolocation: () => GeoSource | undefined = deviceGeolocation,
): AppModule {
  let stopRunning: (() => void) | undefined;

  return {
    name: 'map',
    async start({ source, bus, clock, fixtures }) {
      stopRunning?.();
      const engine = createMapEngine(fixtures);
      log(
        'map',
        `started: ${fixtures.features.length} features, route ${Math.round(engine.routeLengthM)} m, ` +
          `${engine.trackPointCount} track points`,
      );

      let lastTripMs: number | undefined;
      let lastStatus: EngineStatus | undefined;
      let lastLive: Position | undefined;
      let frameId: number | undefined;
      let watchId: number | undefined;

      const publish = ({ position, decisions, ahead, snapshot }: EngineUpdate, tripMs: number) => {
        if (position) bus.emit('position', position);
        ahead.forEach(({ feature, distM }) => {
          const notice: Events['featureAhead'] = {
            featureId: feature.id,
            featureKind: feature.kind,
            distM,
            speedMps: position?.speedMps ?? 0,
            tripMs,
          };
          if (feature.street) notice.street = feature.street;
          bus.emit('featureAhead', notice);
        });
        decisions.forEach(({ cue }) => bus.emit('mapCue', cue));
        if (snapshot.status !== lastStatus) {
          log('map', `route match: ${snapshot.status}`, { tripMs: Math.round(tripMs) });
          lastStatus = snapshot.status;
        }
        mapState.set(snapshot);
      };

      const tick = () => {
        frameId = frames.request(tick);
        const tripMs = clock.nowMs();
        // Paused: the clock stands still, so there is nothing new to emit.
        if (lastTripMs !== undefined && Math.abs(tripMs - lastTripMs) < POSITION_INTERVAL_MS)
          return;
        lastTripMs = tripMs;
        publish(engine.update(tripMs), tripMs);
      };

      const onFix = (fix: GeolocationPosition) => {
        const tripMs = clock.nowMs();
        lastLive = fixToPosition(toGpsFix(fix), tripMs, lastLive);
        publish(engine.updateLive(lastLive), tripMs);
      };

      // Clear only; never emit from here. The arbiter clears its queue on the tripReset that
      // follows, so anything emitted now would be lost. The next frame re-matches the route.
      const offReset = clock.onReset(() => {
        engine.reset();
        lastTripMs = undefined;
        lastStatus = undefined;
        lastLive = undefined;
        mapState.set(EMPTY_SNAPSHOT);
      });

      if (source === 'live') {
        const geo = geolocation();
        if (geo) {
          watchId = geo.watchPosition(
            onFix,
            (e) => {
              log('map', 'location unavailable', e.message);
              mapState.set({ status: 'noPosition', upcoming: [] });
            },
            { enableHighAccuracy: true, maximumAge: 0 },
          );
        } else {
          log('map', 'location unavailable: no geolocation in this browser');
          mapState.set({ status: 'noPosition', upcoming: [] });
        }
      } else {
        // First tick on the next frame, not inside start(): the other modules are still starting.
        frameId = frames.request(tick);
      }

      stopRunning = () => {
        if (frameId !== undefined) frames.cancel(frameId);
        if (watchId !== undefined) geolocation()?.clearWatch(watchId);
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
