import { expect, it } from 'vitest';
import { fallbackAdvice } from './fallbackAdvice.ts';
import { validCoachingText } from '../../../shared/coaching.ts';
import { SCENE_CLASSES, type SceneObject } from '../../../shared/cvScene.ts';

it('uses image-side object cues without inferring pedestrian status or road geometry', () => {
  for (const cls of SCENE_CLASSES) {
    const object: SceneObject = {
      id: 1,
      class: cls,
      confidence: 0.8,
      imageSide: 'right',
      imageZone: 'middle',
      imageMotion: 'unknown',
      apparentSize: 'unknown',
      visibleForMs: 500,
    };
    const text = fallbackAdvice({ tripMs: 1000, objects: [object] }, 0);
    expect(text).toContain('on your right');
    expect(validCoachingText(text)).toBe(true);
    expect(text).not.toMatch(/continue straight|pedestrian|clear|safe to/i);
  }
});
it('uses an observation reminder when no objects are detected', () => {
  expect(fallbackAdvice({ tripMs: 0, objects: [] }, 0)).toBe(
    'Keep observing the road ahead and both sides.',
  );
});
