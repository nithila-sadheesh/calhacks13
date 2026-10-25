import {
  SCENE_MEMORY_MS,
  type CoachingResponse,
  type SceneMemory,
  type VideoFrame,
} from '../../../shared/coaching.ts';

// Keep two recent frames for movement and one earlier anchor for scene continuity.
export function selectCoachingFrames(history: VideoFrame[]): VideoFrame[] {
  if (history.length <= 3) return history.slice();
  const latest = history[history.length - 1]!;
  const anchor = history.find((frame) => frame.tripMs >= latest.tripMs - 10_000) ?? history[0]!;
  return [anchor, history[history.length - 2]!, latest];
}

export function rememberScene(
  memory: SceneMemory[],
  result: CoachingResponse,
  tripMs: number,
): SceneMemory[] {
  const retained = result.sceneChanged
    ? []
    : memory.filter((entry) => tripMs - entry.tripMs <= SCENE_MEMORY_MS && entry.tripMs < tripMs);
  if (!result.observations || !result.uncertainties) return retained;
  return [
    ...retained,
    { tripMs, observations: result.observations, uncertainties: result.uncertainties },
  ].slice(-4);
}
