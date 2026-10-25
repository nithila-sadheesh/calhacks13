import { expect, it } from 'vitest';
import { createSceneGate, SCENE_REVIEW_MS, SCENE_SETTLE_MS } from './sceneGate.ts';
import type { CvScene } from '../../../shared/cvScene.ts';
const scene = (tripMs: number, side: 'left' | 'right' = 'left'): CvScene => ({
  tripMs,
  objects: [
    {
      id: 1,
      class: 'car',
      confidence: 0.9,
      imageSide: side,
      imageZone: 'middle',
      imageMotion: 'stable',
      apparentSize: 'stable',
      visibleForMs: tripMs,
    },
  ],
});
it('analyzes the initial confirmed scene, then reviews stable scenes and debounces changes', () => {
  const gate = createSceneGate();
  expect(gate.ready(scene(0))).toBe(true);
  expect(gate.ready(scene(SCENE_SETTLE_MS))).toBe(true);
  gate.submitted(scene(SCENE_SETTLE_MS));
  expect(gate.ready(scene(SCENE_SETTLE_MS + SCENE_REVIEW_MS - 1))).toBe(false);
  expect(gate.ready(scene(SCENE_SETTLE_MS + SCENE_REVIEW_MS))).toBe(true);
  gate.submitted(scene(60000));
  expect(gate.ready(scene(60100, 'right'))).toBe(false);
  expect(gate.ready(scene(61100, 'right'))).toBe(true);
});
it('ignores transient scene flicker but permits retries and lifecycle resets', () => {
  const gate = createSceneGate();
  gate.ready(scene(0));
  gate.ready(scene(1000));
  gate.submitted(scene(1000));
  gate.ready(scene(1100, 'right'));
  expect(gate.ready(scene(1300))).toBe(false);
  gate.retry();
  expect(gate.ready(scene(2300))).toBe(true);
  gate.submitted(scene(2300));
  gate.reset();
  expect(gate.ready(scene(0))).toBe(true);
  expect(gate.ready(scene(1000))).toBe(true);
});
it('allows a new encounter after a sustained empty view without speaking in empty scenes', () => {
  const gate = createSceneGate();
  gate.ready(scene(0));
  gate.submitted(scene(1000));
  expect(gate.ready({ tripMs: 2000, objects: [] })).toBe(false);
  expect(gate.ready({ tripMs: 4000, objects: [] })).toBe(false);
  expect(gate.ready(scene(5000))).toBe(true);
  expect(gate.ready(scene(6000))).toBe(true);
});
