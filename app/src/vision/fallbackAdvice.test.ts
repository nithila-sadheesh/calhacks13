import { expect, it } from 'vitest';
import { fallbackAdvice } from './fallbackAdvice.ts';
import { validCoachingText } from '../../../shared/coaching.ts';
import { parseDelivery } from '../../../shared/delivery.ts';
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
    const { text, delivery } = fallbackAdvice({ tripMs: 1000, objects: [object] }, 0);
    expect(text).toContain('on your right');
    expect(validCoachingText(text)).toBe(true);
    expect(text).not.toMatch(/continue straight|pedestrian|clear|safe to|controls/i);
    expect(parseDelivery(delivery)).toEqual(delivery);
  }
});

it('never asks which approach a sign or signal controls', () => {
  const sign = (cls: 'stop sign' | 'traffic light') =>
    fallbackAdvice(
      {
        tripMs: 0,
        objects: [
          {
            id: 1,
            class: cls,
            confidence: 0.8,
            imageSide: 'center',
            imageZone: 'upper',
            imageMotion: 'stable',
            apparentSize: 'growing',
            visibleForMs: 800,
          },
        ],
      },
      0,
    );
  expect(sign('stop sign').text).toBe('Stop sign ahead; prepare for a complete stop.');
  expect(sign('traffic light').text).toBe('Traffic light ahead; be ready to stop.');
  expect(sign('stop sign').delivery.emotion).toBe('determined');
});

it('uses a calm observation reminder when no objects are detected', () => {
  const reminder = fallbackAdvice({ tripMs: 0, objects: [] }, 0);
  expect(reminder.text).toBe('Keep observing the road ahead and both sides.');
  expect(reminder.delivery.emotion).toBe('calm');
});
