// VLM wire format and validation shared by the browser and server.
export type VideoFrame = { tripMs: number; jpeg: string };
export type CoachingRequest = { frames: VideoFrame[]; recentAdvice: string[] };
export type CoachingResponse = { shouldSpeak: boolean; message: string; reason: string };
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
  return {
    shouldSpeak: item.shouldSpeak,
    message: item.message.trim(),
    reason: item.reason.trim(),
  };
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
  return { frames, recentAdvice: item.recentAdvice as string[] };
}

export function adviceKey(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
