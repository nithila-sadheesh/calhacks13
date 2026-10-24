import { expect, it } from 'vitest';
import { parseCvScene } from './cvScene.ts';
import { parseCoachingRequest } from './coaching.ts';
const scene = {
  tripMs: 1000,
  objects: [
    {
      id: 1,
      class: 'car',
      confidence: 0.9,
      imageSide: 'left',
      imageZone: 'middle',
      imageMotion: 'unknown',
      apparentSize: 'unknown',
      visibleForMs: 600,
    },
  ],
};
it('validates image-free scenes and strips unspecified input fields', () => {
  expect(parseCvScene(scene)).toEqual(scene);
  const parsed = parseCoachingRequest({
    scene: { ...scene, lat: 123 },
    recentAdvice: [],
    previousScenes: [],
  });
  expect(parsed?.scene).toEqual(scene);
  expect(parsed?.frames).toBeUndefined();
  expect(parseCoachingRequest({ scene, frames: [], recentAdvice: [] })).toBeUndefined();
  expect(
    parseCvScene({ ...scene, objects: [{ ...scene.objects[0], confidence: 5 }] }),
  ).toBeUndefined();
  expect(
    parseCoachingRequest({ scene, recentAdvice: [], previousScenes: [{ ...scene, tripMs: 2000 }] }),
  ).toBeUndefined();
});
