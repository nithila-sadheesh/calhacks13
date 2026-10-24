// The map module's logic with no browser or bus attached: given a trip time, it returns the
// interpolated position, any cues due now, and a snapshot for the Upcoming panel. Cue decisions
// come only from track data and map features at that moment, never from preset trip times.
import type { Fixtures, MapFeature, Position } from '../../../shared/types.ts';
import { decideCue, type CueDecision } from './cues.ts';
import { buildRouteLine, matchRoute } from './geo.ts';
import {
  advanceProgress,
  PROGRESS_TUNING,
  type MatchStatus,
  type ProgressState,
} from './progress.ts';
import { interpolateTrack, odometer, odometerAt, withMotion } from './track.ts';

export type EngineStatus = MatchStatus | 'waiting' | 'noPosition' | 'noRoute';

export type UpcomingFeature = Pick<MapFeature, 'id' | 'kind' | 'street' | 'source'> & {
  distM: number;
};

export type MapSnapshot = {
  status: EngineStatus;
  progressM?: number;
  accuracyM?: number;
  upcoming: UpcomingFeature[];
};

export type EngineUpdate = { position?: Position; decisions: CueDecision[]; snapshot: MapSnapshot };

export const EMPTY_SNAPSHOT: MapSnapshot = { status: 'waiting', upcoming: [] };

const UPCOMING_COUNT = 3;
// No window opens this far out at any plausible street speed; skips work on distant features.
const MAX_LOOKAHEAD_M = 500;

export function createMapEngine({ track, features, route }: Fixtures) {
  const line = buildRouteLine(route.coordinates);
  const points = withMotion(track.points);
  const travelled = odometer(points);
  const ordered = [...features].sort((a, b) => a.routeDistM - b.routeDistM);
  const first = points[0];
  // Where the recording starts on the route; with the odometer, this guides the first match.
  const startM = first
    ? (matchRoute(line, first.lat, first.lon, 0, PROGRESS_TUNING.candidateToleranceM)?.routeDistM ??
      0)
    : 0;

  let progress: ProgressState = {};
  let lastUpdateMs: number | undefined;
  let pass = 0;
  const fired = new Set<string>();

  const snapshot = (status: EngineStatus, position?: Position): MapSnapshot => {
    const { progressM } = progress;
    const upcoming =
      progressM === undefined
        ? []
        : ordered
            .filter((f) => f.routeDistM > progressM)
            .slice(0, UPCOMING_COUNT)
            .map(({ id, kind, street, source, routeDistM }) => ({
              id,
              kind,
              street,
              source,
              distM: routeDistM - progressM,
            }));
    const snap: MapSnapshot = { status, upcoming };
    if (progressM !== undefined) snap.progressM = progressM;
    if (position?.accuracyM !== undefined) snap.accuracyM = position.accuracyM;
    return snap;
  };

  const decide = (position: Position, progressM: number): CueDecision[] => {
    const out: CueDecision[] = [];
    for (const feature of ordered) {
      const remainingM = feature.routeDistM - progressM;
      if (remainingM > MAX_LOOKAHEAD_M) break;
      if (remainingM <= 0 || fired.has(feature.id)) continue;
      const decision = decideCue(feature, remainingM, position.speedMps, position.tripMs, pass);
      if (!decision) continue;
      fired.add(feature.id);
      out.push(decision);
    }
    return out;
  };

  return {
    routeLengthM: line.lengthM,
    trackPointCount: points.length,

    update(tripMs: number): EngineUpdate {
      // The first update after a reset only finds where we are. Cues need the clock to move,
      // so nothing is said at load or right after a seek while paused.
      const moving = lastUpdateMs !== undefined && tripMs > lastUpdateMs;
      lastUpdateMs = tripMs;

      const position = interpolateTrack(points, tripMs);
      if (!position) return { decisions: [], snapshot: snapshot('noPosition') };
      if (line.coords.length < 2)
        return { position, decisions: [], snapshot: snapshot('noRoute', position) };

      const priorM = startM + odometerAt(points, travelled, tripMs);
      const step = advanceProgress(line, progress, position, priorM);
      progress = step.state;
      const decisions =
        step.status === 'ok' && moving && progress.progressM !== undefined
          ? decide(position, progress.progressM)
          : [];
      return { position, decisions, snapshot: snapshot(step.status, position) };
    },

    reset() {
      progress = {};
      lastUpdateMs = undefined;
      pass += 1;
      fired.clear();
    },
  };
}

export type MapEngine = ReturnType<typeof createMapEngine>;
