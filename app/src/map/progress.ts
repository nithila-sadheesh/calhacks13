// Route progress: project each position onto the route and keep the furthest plausible forward
// distance. Positions that are too inaccurate, off the route, or jump backward or too far forward
// do not move progress, and the caller makes no cue decision on them. No rerouting and no dead
// reckoning (docs/DESIGN.md, Jeev task 5).
import type { Position } from '../../../shared/types.ts';
import { matchRoute, type RouteLine } from './geo.ts';

export const PROGRESS_TUNING = {
  maxAccuracyM: 25,
  // Further than this from the route line, the position is not on the planned route.
  maxOffsetM: 40,
  // Projections within this of the closest one count as candidates (loops, overlapping passes).
  candidateToleranceM: 15,
  // GPS jitter while stopped moves the projection back a little; more than this is a jump.
  backwardToleranceM: 5,
  // Forward moves beyond slack + 2 x speed x elapsed are implausible.
  forwardSlackM: 30,
  minSpeedMps: 2,
  // A backward jump that lasts this long means we matched the wrong pass: match afresh.
  reacquireAfterMs: 5000,
} as const;

export type MatchStatus = 'ok' | 'lowAccuracy' | 'offRoute' | 'backward' | 'jump';

export type ProgressState = { progressM?: number; acceptedMs?: number };

export type ProgressStep = { state: ProgressState; status: MatchStatus };

// initialPriorM guides the first match after a reset, when there is no progress to follow yet.
export function advanceProgress(
  line: RouteLine,
  state: ProgressState,
  pos: Position,
  initialPriorM: number,
): ProgressStep {
  const tuning = PROGRESS_TUNING;
  if (pos.accuracyM !== undefined && pos.accuracyM > tuning.maxAccuracyM)
    return { state, status: 'lowAccuracy' };

  const { progressM, acceptedMs } = state;
  const tracking = progressM !== undefined && acceptedMs !== undefined;
  const elapsedS = tracking ? Math.max(0, pos.tripMs - acceptedMs) / 1000 : 0;
  const priorM = tracking ? progressM + pos.speedMps * elapsedS : initialPriorM;
  const match = matchRoute(line, pos.lat, pos.lon, priorM, tuning.candidateToleranceM);
  if (!match || match.offsetM > tuning.maxOffsetM) return { state, status: 'offRoute' };

  const accepted = (routeDistM: number): ProgressStep => ({
    state: { progressM: routeDistM, acceptedMs: pos.tripMs },
    status: 'ok',
  });
  if (!tracking) return accepted(match.routeDistM);

  if (match.routeDistM < progressM - tuning.backwardToleranceM) {
    if (elapsedS * 1000 >= tuning.reacquireAfterMs) return { state: {}, status: 'backward' };
    return { state, status: 'backward' };
  }
  const speed = Math.max(pos.speedMps, tuning.minSpeedMps);
  if (match.routeDistM > progressM + tuning.forwardSlackM + 2 * speed * elapsedS)
    return { state, status: 'jump' };
  return accepted(Math.max(progressM, match.routeDistM));
}
