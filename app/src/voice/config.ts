export const CARTESIA_VERSION = '2026-08-14';
export const SONIC_MODEL = 'sonic-3.6';
export const VOICE_ID = 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4';
export const SAMPLE_RATE = 24000;
export const CLIP_TEXT = {
  pedestrianNearby: 'Pedestrian ahead. Stay alert.',
  followingDistance: 'Leave more space ahead.',
  cameraPaused: 'Camera paused. Route reminders only.',
  turn: 'Turn ahead.',
  stopSign: 'Stop sign ahead.',
  crosswalk: 'Crosswalk ahead.',
} as const;
export type ClipKey = keyof typeof CLIP_TEXT;

export function fallbackKey(text: string): ClipKey | undefined {
  if (
    /^Left turn ahead onto [^\r\n]+\. Check for pedestrians before turning\.$/.test(text) ||
    /^Right turn ahead onto [^\r\n]+\. Check your mirror and blind spot\.$/.test(text)
  )
    return 'turn';
  if (text === 'Stop sign ahead. Prepare for a complete stop.') return 'stopSign';
  if (text === 'Crosswalk ahead. Scan both sides.') return 'crosswalk';
  return (Object.keys(CLIP_TEXT) as ClipKey[]).find((key) => CLIP_TEXT[key] === text);
}

export function approvedText(text: string): boolean {
  return fallbackKey(text) !== undefined || text === 'Traffic light ahead. Be ready to stop.';
}
