export const SCENE_CLASSES = [
  'person',
  'bicycle',
  'car',
  'truck',
  'bus',
  'motorcycle',
  'stop sign',
  'traffic light',
] as const;
export type SceneClass = (typeof SCENE_CLASSES)[number];
export type SceneObject = {
  id: number;
  class: SceneClass;
  confidence: number;
  imageSide: 'left' | 'center' | 'right';
  imageZone: 'upper' | 'middle' | 'lower';
  imageMotion: 'leftward' | 'rightward' | 'stable' | 'unknown';
  apparentSize: 'growing' | 'shrinking' | 'stable' | 'unknown';
  visibleForMs: number;
};
export type CvScene = { tripMs: number; objects: SceneObject[] };
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === 'string' && choices.includes(value as T);
export function parseCvScene(value: unknown): CvScene | undefined {
  if (!value || typeof value !== 'object') return;
  const scene = value as Record<string, unknown>;
  if (
    typeof scene.tripMs !== 'number' ||
    !Number.isFinite(scene.tripMs) ||
    scene.tripMs < 0 ||
    !Array.isArray(scene.objects) ||
    scene.objects.length > 10
  )
    return;
  const objects: SceneObject[] = [];
  for (const raw of scene.objects) {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id !== 'number' ||
      !Number.isSafeInteger(item.id) ||
      item.id < 1 ||
      objects.some((object) => object.id === item.id) ||
      !oneOf(item.class, SCENE_CLASSES) ||
      typeof item.confidence !== 'number' ||
      !Number.isFinite(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1 ||
      !oneOf(item.imageSide, ['left', 'center', 'right']) ||
      !oneOf(item.imageZone, ['upper', 'middle', 'lower']) ||
      !oneOf(item.imageMotion, ['leftward', 'rightward', 'stable', 'unknown']) ||
      !oneOf(item.apparentSize, ['growing', 'shrinking', 'stable', 'unknown']) ||
      typeof item.visibleForMs !== 'number' ||
      !Number.isFinite(item.visibleForMs) ||
      item.visibleForMs < 0 ||
      item.visibleForMs > 3_600_000
    )
      return;
    objects.push({
      id: item.id,
      class: item.class,
      confidence: item.confidence,
      imageSide: item.imageSide,
      imageZone: item.imageZone,
      imageMotion: item.imageMotion,
      apparentSize: item.apparentSize,
      visibleForMs: item.visibleForMs,
    });
  }
  return { tripMs: scene.tripMs, objects };
}
