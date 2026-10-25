import type { CvScene, SceneObject } from '../../../shared/cvScene.ts';
import type { Track } from './tracker.ts';
import type { Box } from './geometry.ts';

type Sample = { tripMs: number; box: Box };
type History = { firstMs: number; lastMs: number; count: number; samples: Sample[] };
export function createSceneBuilder() {
  const history = new Map<number, History>();
  return {
    reset() {
      history.clear();
    },
    update(tracks: Track[], tripMs: number): CvScene {
      for (const [id, value] of history) if (tripMs - value.lastMs > 1000) history.delete(id);
      const objects: SceneObject[] = [];
      for (const track of tracks) {
        if (track.score < (track.cls === 'stop sign' || track.cls === 'traffic light' ? 0.4 : 0.45))
          continue;
        let state = history.get(track.id);
        if (!state) {
          state = { firstMs: tripMs, lastMs: tripMs, count: 0, samples: [] };
          history.set(track.id, state);
        }
        if (state.samples.at(-1)?.tripMs === tripMs) continue;
        state.count++;
        state.lastMs = tripMs;
        state.samples = [
          ...state.samples.filter((sample) => tripMs - sample.tripMs <= 1000),
          { tripMs, box: track.box },
        ];
        if (state.count < 2) continue;
        const centerX = track.box.x + track.box.w / 2;
        const centerY = track.box.y + track.box.h / 2;
        const old = state.samples[0]!;
        const canCompare = tripMs - old.tripMs >= 500;
        const dx = centerX - (old.box.x + old.box.w / 2);
        const ratio = (track.box.w * track.box.h) / Math.max(0.0001, old.box.w * old.box.h);
        objects.push({
          imageBox: {
            x: Math.max(0, track.box.x),
            y: Math.max(0, track.box.y),
            w: Math.min(track.box.w, 1 - Math.max(0, track.box.x)),
            h: Math.min(track.box.h, 1 - Math.max(0, track.box.y)),
          },
          id: track.id,
          class: track.cls,
          confidence: Math.round(track.score * 100) / 100,
          imageSide: centerX < 0.35 ? 'left' : centerX > 0.65 ? 'right' : 'center',
          imageZone: centerY < 0.33 ? 'upper' : centerY > 0.66 ? 'lower' : 'middle',
          imageMotion: !canCompare
            ? 'unknown'
            : dx > 0.04
              ? 'rightward'
              : dx < -0.04
                ? 'leftward'
                : 'stable',
          apparentSize: !canCompare
            ? 'unknown'
            : ratio > 1.25
              ? 'growing'
              : ratio < 0.8
                ? 'shrinking'
                : 'stable',
          visibleForMs: Math.round(tripMs - state.firstMs),
        });
      }
      return { tripMs, objects: objects.slice(0, 10) };
    },
  };
}

export function sceneKey(scene: CvScene): string {
  // Ignore tracker IDs and confidence jitter; only coarse scene changes trigger coaching.
  return scene.objects
    .map(
      (object) =>
        `${object.class}:${object.imageSide}:${object.imageZone}:${object.imageMotion === 'leftward' || object.imageMotion === 'rightward' ? object.imageMotion : 'steady'}:${object.apparentSize === 'growing' || object.apparentSize === 'shrinking' ? object.apparentSize : 'steady'}`,
    )
    .sort()
    .join('|');
}
