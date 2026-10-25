import type { CvScene } from '../../../shared/cvScene.ts';
import { sceneKey } from './cvScene.ts';

export const SCENE_SETTLE_MS = 1000;
export const SCENE_REVIEW_MS = 8000;
const EMPTY_RESET_MS = 2000;

// Revisit stable observations so one silent response cannot disable commentary for an encounter.
export function createSceneGate() {
  let candidate: string | undefined;
  let sinceMs = 0;
  let submitted: string | undefined;
  let submittedMs = 0;
  return {
    reset() {
      candidate = submitted = undefined;
      sinceMs = submittedMs = 0;
    },
    ready(scene: CvScene): boolean {
      const key = sceneKey(scene);
      if (key !== candidate) {
        candidate = key;
        sinceMs = scene.tripMs;
      }
      if (!key) {
        if (scene.tripMs - sinceMs >= EMPTY_RESET_MS) submitted = undefined;
        return false;
      }
      // The initial snapshot has already passed the CV builder's repeated-observation filter.
      if (submitted === undefined) return true;
      return (
        (key !== submitted && scene.tripMs - sinceMs >= SCENE_SETTLE_MS) ||
        (key === submitted && scene.tripMs - submittedMs >= SCENE_REVIEW_MS)
      );
    },
    retry() {
      submitted = undefined;
    },
    submitted(scene: CvScene) {
      submitted = sceneKey(scene);
      submittedMs = scene.tripMs;
    },
  };
}
