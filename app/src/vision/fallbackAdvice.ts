import type { CvScene } from '../../../shared/cvScene.ts';
import type { Delivery } from '../../../shared/types.ts';

export type LocalReminder = { text: string; delivery: Delivery };

// Local reminders fill long silences when Claude has nothing new. Each carries its own delivery so
// a stop sign sounds firmer than a general scanning reminder.
export function fallbackAdvice(scene: CvScene, turn: number): LocalReminder {
  const ranked = [...scene.objects].sort((a, b) => {
    const priority = (name: string) =>
      name === 'person' || name === 'bicycle' || name === 'stop sign' ? 0 : 1;
    return priority(a.class) - priority(b.class) || b.confidence - a.confidence;
  });
  const object = ranked[0];
  const firm: Delivery = { emotion: 'determined', pace: 'normal', speed: 1.05, volume: 1.1 };
  const steady: Delivery = { emotion: 'confident', pace: 'normal', speed: 1.0, volume: 1.0 };
  if (!object)
    return {
      text:
        turn % 2 === 0
          ? 'Keep observing the road ahead and both sides.'
          : 'Scan ahead for changes in traffic and road conditions.',
      delivery: { emotion: 'calm', pace: 'normal', speed: 0.95, volume: 0.95 },
    };
  const location = object.imageSide === 'center' ? 'ahead' : `on your ${object.imageSide}`;
  if (object.class === 'person')
    return { text: `Watch the person ${location} for changes in movement.`, delivery: firm };
  if (object.class === 'stop sign')
    return { text: `Stop sign ${location}; prepare for a complete stop.`, delivery: firm };
  if (object.class === 'traffic light')
    return { text: `Traffic light ${location}; be ready to stop.`, delivery: firm };
  if (object.class === 'bicycle')
    return {
      text: `Keep the cyclist ${location} in view while checking surrounding space.`,
      delivery: firm,
    };
  return {
    text: `Keep the ${object.class} ${location} in view as you scan ahead.`,
    delivery: steady,
  };
}
