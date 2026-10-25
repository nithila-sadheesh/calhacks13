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

// Phrases Ink should favor (its `keyterm` hints): the voice commands first, then the driving words
// learners ask about. Street names on the loaded route are added at start (inkKeyterms).
export const BASE_KEYTERMS = [
  'repeat that',
  'repeat',
  'say that again',
  'mute',
  'unmute',
  'stop sign',
  'crosswalk',
  'traffic light',
  'left turn',
  'right turn',
  'turn signal',
  'blind spot',
  'pedestrian',
  'yield',
  'merge',
  'lane',
  'supervisor',
  'roundabout',
  'four-way stop',
  'parking brake',
  'mirror',
];

export function inkKeyterms(streets: readonly (string | undefined)[]): string[] {
  const named = streets.filter((s): s is string => Boolean(s?.trim())).map((s) => s.trim());
  return [...new Set([...BASE_KEYTERMS, ...named])];
}
