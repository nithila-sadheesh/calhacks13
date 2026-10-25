import type { CvScene } from '../../../shared/cvScene.ts';

export function fallbackAdvice(scene: CvScene, turn: number): string {
  const ranked = [...scene.objects].sort((a, b) => {
    const priority = (name: string) =>
      name === 'person' || name === 'bicycle' || name === 'stop sign' ? 0 : 1;
    return priority(a.class) - priority(b.class) || b.confidence - a.confidence;
  });
  const object = ranked[0];
  if (!object)
    return turn % 2 === 0
      ? 'Keep observing the road ahead and both sides.'
      : 'Scan ahead for changes in traffic and road conditions.';
  const location = object.imageSide === 'center' ? 'ahead' : `on your ${object.imageSide}`;
  if (object.class === 'person') return `Watch the person ${location} for changes in movement.`;
  if (object.class === 'stop sign')
    return `Check which approach the stop sign ${location} controls.`;
  if (object.class === 'traffic light')
    return `Check which approach the traffic signal ${location} controls.`;
  if (object.class === 'bicycle')
    return `Keep the cyclist ${location} in view while checking surrounding space.`;
  return `Keep the ${object.class} ${location} in view as you scan ahead.`;
}
