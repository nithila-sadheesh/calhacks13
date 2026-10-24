// The last check on any generated line before it can be spoken or shown. Claude is prompted with
// the same rules; this catches a slip. It enforces AGENTS.md section 3 rule 7: never tell the
// driver to brake, never say a lane or intersection is clear, never decide right-of-way, never
// state a traffic-light color, never estimate collision timing, never assert a speed limit.
// Fixed, human-approved phrases (the bundled clips, the route templates) do not go through this.

export const MAX_SPOKEN_CHARS = 220;

const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/\bbrak(e|es|ed|ing)\b|\bslam\b|\bstop now\b|\bstop immediately\b/i, 'braking instruction'],
  [
    /\b(is|are|looks?|seems?)\s+(all\s+)?clear\b|\bclear to (go|turn|proceed|merge|cross)\b/i,
    'says the way is clear',
  ],
  [
    /\bsafe to (go|turn|proceed|merge|cross|pull out)\b|\b(go|turn|proceed) now\b|\bgo ahead\b|\byou can go\b/i,
    'tells the driver to go',
  ],
  [
    /\bright[- ]of[- ]way\b|\byour turn to go\b|\byou have priority\b|\byield to you\b/i,
    'decides right-of-way',
  ],
  [
    /\b(green|red|yellow|amber)\s+(light|signal|arrow)\b|\blight is (green|red|yellow|amber)\b/i,
    'states a light color',
  ],
  [
    /\bcollision\b|\bcollide\b|\bcrash\b|\bimpact\b|\bseconds? (to|until|before) (hit|reach|contact)\b/i,
    'collision timing',
  ],
  [
    /\bspeed limit\b|\blimit is \d+\b|\b\d+\s*(mph|km\/h|kph)\s+(zone|limit)\b/i,
    'asserts a speed limit',
  ],
];

export function unsafeReason(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > MAX_SPOKEN_CHARS) return 'too long to speak';
  for (const [pattern, reason] of FORBIDDEN) if (pattern.test(trimmed)) return reason;
  return undefined;
}

export function isSafeToSpeak(text: string): boolean {
  return unsafeReason(text) === undefined;
}
