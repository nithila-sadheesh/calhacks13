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

it('accepts a whole-second gap since the last suggestion and rejects malformed ones', () => {
  expect(
    parseCoachingRequest({ scene, recentAdvice: [], secondsSinceAdvice: 42 })?.secondsSinceAdvice,
  ).toBe(42);
  for (const secondsSinceAdvice of [-1, 1.5, '42', Infinity])
    expect(parseCoachingRequest({ scene, recentAdvice: [], secondsSinceAdvice })).toBeUndefined();
});
