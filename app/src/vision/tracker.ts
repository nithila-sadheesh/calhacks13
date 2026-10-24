// Pure IoU tracker (docs/DESIGN.md task 3): match detection boxes between frames by overlap,
// smooth their position and size, and give each a stable id so the alert rules can reason about
// "the same person over the last few frames". No browser or clock needed, so it unit-tests.
import type { DetectorClass } from './config.ts';
import { TRACK_IOU_MATCH, TRACK_MAX_MISSES, TRACK_SMOOTHING } from './config.ts';
import { iou, smoothBox, type Box } from './geometry.ts';

export type Detection = { cls: DetectorClass; score: number; box: Box };

// A detection that survived association, with a stable id. box is the smoothed box.
export type Track = { id: number; cls: DetectorClass; score: number; box: Box };

type TrackState = Track & { misses: number };

export type Tracker = {
  // Associate this frame's detections to existing tracks and return the tracks present this
  // frame (oldest id first), each with its smoothed box.
  update(detections: Detection[]): Track[];
  reset(): void;
};

export function createTracker(iouMatch = TRACK_IOU_MATCH, smoothing = TRACK_SMOOTHING): Tracker {
  let states: TrackState[] = [];
  let nextId = 1;

  function update(detections: Detection[]): Track[] {
    const unmatchedStates = new Set(states);
    const present: TrackState[] = [];

    // Greedy best-IoU association, same class only, one detection to one track.
    for (const det of detections) {
      let best: TrackState | undefined;
      let bestIou = iouMatch;
      for (const state of unmatchedStates) {
        if (state.cls !== det.cls) continue;
        const overlap = iou(state.box, det.box);
        if (overlap >= bestIou) {
          best = state;
          bestIou = overlap;
        }
      }
      if (best) {
        unmatchedStates.delete(best);
        best.box = smoothBox(best.box, det.box, smoothing);
        best.score = det.score;
        best.misses = 0;
        present.push(best);
      } else {
        const fresh: TrackState = {
          id: nextId++,
          cls: det.cls,
          score: det.score,
          box: det.box,
          misses: 0,
        };
        states.push(fresh);
        present.push(fresh);
      }
    }

    // Age out tracks that went unmatched this frame; drop the long-missing ones.
    for (const state of unmatchedStates) state.misses += 1;
    states = states.filter((s) => s.misses <= TRACK_MAX_MISSES);

    present.sort((a, b) => a.id - b.id);
    return present.map(({ id, cls, score, box }) => ({ id, cls, score, box }));
  }

  function reset(): void {
    states = [];
    nextId = 1;
  }

  return { update, reset };
}
