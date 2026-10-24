// VLM wire format and validation shared by the browser and server.
export type VideoFrame = { tripMs: number; jpeg: string };
export type SceneMemory = { tripMs: number; observations: string[]; uncertainties: string[] };
export type CoachingRequest = {
  frames: VideoFrame[];
  recentAdvice: string[];
  sceneMemory?: SceneMemory[];
};
export type CoachingResponse = {
  shouldSpeak: boolean;
  message: string;
  reason: string;
  observations?: string[];
  uncertainties?: string[];
  coachingPoint?: string;
  sceneChanged?: boolean;
};
export const SCENE_MEMORY_MS = 20_000;
const cleanText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && !hasControl(value) && !/[<>]/.test(value);
function factList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 3 &&
    value.every((item) => cleanText(item, 160) && item.trim().length > 0)
  );
}
export function parseSceneMemory(value: unknown, newestTripMs: number): SceneMemory[] | undefined {
  if (!Array.isArray(value) || value.length > 4) return;
  const result: SceneMemory[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    if (
      typeof item.tripMs !== 'number' ||
      !Number.isFinite(item.tripMs) ||
      item.tripMs < 0 ||
      item.tripMs > newestTripMs ||
      newestTripMs - item.tripMs > SCENE_MEMORY_MS ||
      !factList(item.observations) ||
      !factList(item.uncertainties)
    )
      return;
    if (result.length && item.tripMs <= result[result.length - 1]!.tripMs) return;
    result.push({
      tripMs: item.tripMs,
      observations: item.observations,
      uncertainties: item.uncertainties,
    });
  }
  return result;
}
export const MAX_COACHING_BODY_BYTES = 800_000;
export const MAX_ADVICE_CHARS = 180;

const hasControl = (value: string) => [...value].some((char) => char.charCodeAt(0) < 32);

export function validCoachingText(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_ADVICE_CHARS ||
    hasControl(value) ||
    /[<>]/.test(value)
  )
    return false;
  // Defense in depth only; this is not a proof of driving safety.
  return !/\b(brake|accelerate|speed up|go now|right.of.way|safe to|clear to|lane is clear|intersection is clear|green light|red light|yellow light|speed limit|collision in|guarantee)\b/i.test(
    value,
  );
}

export function parseCoachingResponse(value: unknown): CoachingResponse | undefined {
  if (!value || typeof value !== 'object') return;
  const item = value as Record<string, unknown>;
  if (
    typeof item.shouldSpeak !== 'boolean' ||
    typeof item.message !== 'string' ||
    typeof item.reason !== 'string' ||
    item.reason.length > 300 ||
    hasControl(item.reason) ||
    /[<>]/.test(item.reason)
  )
    return;
  if (item.shouldSpeak ? !validCoachingText(item.message) : item.message !== '') return;
  const result: CoachingResponse = {
    shouldSpeak: item.shouldSpeak,
    message: item.message.trim(),
    reason: item.reason.trim(),
  };
  if (
    ['observations', 'uncertainties', 'coachingPoint', 'sceneChanged'].some((key) => key in item)
  ) {
    if (
      !factList(item.observations) ||
      !factList(item.uncertainties) ||
      !cleanText(item.coachingPoint, 180) ||
      typeof item.sceneChanged !== 'boolean'
    )
      return;
    if (item.shouldSpeak && (!item.observations.length || !item.coachingPoint.trim())) return;
    result.observations = item.observations;
    result.uncertainties = item.uncertainties;
    result.coachingPoint = item.coachingPoint;
    result.sceneChanged = item.sceneChanged;
  }
  return result;
}

export function parseCoachingRequest(value: unknown): CoachingRequest | undefined {
  if (!value || typeof value !== 'object') return;
  const item = value as Record<string, unknown>;
  if (
    !Array.isArray(item.frames) ||
    item.frames.length < 2 ||
    item.frames.length > 3 ||
    !Array.isArray(item.recentAdvice) ||
    item.recentAdvice.length > 3
  )
    return;
  const frames: VideoFrame[] = [];
  for (const frame of item.frames) {
    if (!frame || typeof frame !== 'object') return;
    const f = frame as Record<string, unknown>;
    if (
      typeof f.tripMs !== 'number' ||
      !Number.isFinite(f.tripMs) ||
      f.tripMs < 0 ||
      typeof f.jpeg !== 'string' ||
      f.jpeg.length > 240_000 ||
      !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(f.jpeg)
    )
      return;
    if (frames.length && f.tripMs <= frames[frames.length - 1]!.tripMs) return;
    frames.push({ tripMs: f.tripMs, jpeg: f.jpeg });
  }
  if (!item.recentAdvice.every(validCoachingText)) return;
  const result: CoachingRequest = { frames, recentAdvice: item.recentAdvice as string[] };
  if (item.sceneMemory !== undefined) {
    const memory = parseSceneMemory(item.sceneMemory, frames[frames.length - 1]!.tripMs);
    if (!memory) return;
    result.sceneMemory = memory;
  }
  return result;
}

export function adviceKey(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
