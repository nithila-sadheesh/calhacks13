import { expect, it } from 'vitest';
import { createSceneBuilder, sceneKey } from './cvScene.ts';
import type { Track } from './tracker.ts';
const track = (extra: Partial<Track> = {}): Track => ({
  id: 1,
  cls: 'car',
  score: 0.9,
  box: { x: 0.1, y: 0.4, w: 0.2, h: 0.2 },
  ...extra,
});
it('requires repeated observations and only reports image geometry, not physical approach', () => {
  const builder = createSceneBuilder();
  expect(builder.update([track()], 0).objects).toEqual([]);
  const scene = builder.update([track()], 200);
  expect(scene.objects[0]).toMatchObject({
    class: 'car',
    imageSide: 'left',
    imageMotion: 'unknown',
    apparentSize: 'unknown',
  });
  const moved = builder.update([track({ box: { x: 0.3, y: 0.4, w: 0.3, h: 0.3 } })], 800);
  expect(moved.objects[0]).toMatchObject({ imageMotion: 'rightward', apparentSize: 'growing' });
  expect(JSON.stringify(moved)).not.toMatch(/distance|speedMps|arrivalOrder/);
  builder.reset();
  expect(builder.update([track()], 1000).objects).toEqual([]);
});
it('ignores weak detections and ID/confidence churn in scene keys', () => {
  const builder = createSceneBuilder();
  expect(builder.update([track({ score: 0.4 })], 0).objects).toEqual([]);
  builder.update([track()], 100);
  const scene = builder.update([track()], 300);
  expect(sceneKey(scene)).toBe(
    sceneKey({
      ...scene,
      objects: scene.objects.map((object) => ({ ...object, id: 99, confidence: 0.8 })),
    }),
  );
});

it('retains repeated lower-confidence signs and normalized geometry, but rejects weak cars', () => {
  const builder = createSceneBuilder();
  const sign = track({ cls: 'stop sign', score: 0.42 });
  builder.update([sign], 0);
  const scene = builder.update([sign], 125);
  expect(scene.objects[0]).toMatchObject({
    class: 'stop sign',
    confidence: 0.42,
    imageBox: sign.box,
  });
  expect(builder.update([track({ id: 2, score: 0.42 })], 250).objects).toEqual([]);
});
