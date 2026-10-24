// Cue timing and wording. The only text this module ever produces comes from TEMPLATES, which are
// the approved route-reminder phrases (AGENTS.md section 8), word for word.
import type { MapCue, MapFeature, MapFeatureKind } from '../../../shared/types.ts';

type CueRule = {
  label: string; // for the reason line and the Upcoming panel, never spoken
  windowS: [closesS: number, opensS: number]; // speak while time to arrival is in here
  dropAfterS: number;
  priority: 1 | 2;
};

// Starting values from docs/DESIGN.md; final tuned numbers are recorded in NOTES.md.
export const CUE_RULES: Record<MapFeatureKind, CueRule> = {
  turnLeft: { label: 'left turn', windowS: [6, 9], dropAfterS: 3, priority: 1 },
  turnRight: { label: 'right turn', windowS: [5, 8], dropAfterS: 3, priority: 1 },
  stopSign: { label: 'stop sign', windowS: [6, 9], dropAfterS: 3, priority: 1 },
  crosswalk: { label: 'crosswalk', windowS: [5, 7], dropAfterS: 2, priority: 2 },
  signal: { label: 'traffic light', windowS: [5, 8], dropAfterS: 3, priority: 2 },
};

const TEMPLATES: Record<MapFeatureKind, (street: string) => string> = {
  turnLeft: (street) => `Left turn ahead onto ${street}. Check for pedestrians before turning.`,
  turnRight: (street) => `Right turn ahead onto ${street}. Check your mirror and blind spot.`,
  stopSign: () => 'Stop sign ahead. Prepare for a complete stop.',
  crosswalk: () => 'Crosswalk ahead. Scan both sides.',
  signal: () => 'Traffic light ahead. Be ready to stop.',
};

const needsStreet = (kind: MapFeatureKind) => kind === 'turnLeft' || kind === 'turnRight';

export const SPEECH_CHARS_PER_S = 14;
// Slow or stopped: time to arrival uses at least this speed, so a creeping car is not "never".
export const MIN_SPEED_MPS = 2;
// A long line opens its window early enough to finish this long before the feature.
const SPEECH_MARGIN_S = 1;

// Undefined for a turn with no street name: the approved phrase cannot be filled in, so no cue.
export function cueText(kind: MapFeatureKind, street?: string): string | undefined {
  const name = street?.trim();
  if (needsStreet(kind) && !name) return undefined;
  return TEMPLATES[kind](name ?? '');
}

export function speechMs(text: string): number {
  return (text.length / SPEECH_CHARS_PER_S) * 1000;
}

export function featureLabel(feature: Pick<MapFeature, 'kind' | 'street'>): string {
  const label = CUE_RULES[feature.kind].label;
  return needsStreet(feature.kind) && feature.street ? `${label} onto ${feature.street}` : label;
}

export type CueDecision = { cue: MapCue; ttaS: number; remainingM: number };

// A cue for the feature if its time to arrival is inside the window now, else undefined.
// expiresMs is the earlier of the drop-after limit and the last start that still finishes
// speaking before the estimated arrival. `pass` counts resets, so a cue replayed after a seek
// back gets a new id even at the same trip time.
export function decideCue(
  feature: MapFeature,
  remainingM: number,
  speedMps: number,
  nowMs: number,
  pass = 0,
): CueDecision | undefined {
  const rule = CUE_RULES[feature.kind];
  const text = cueText(feature.kind, feature.street);
  if (!text || remainingM <= 0) return undefined;

  const speed = Math.max(speedMps, MIN_SPEED_MPS);
  const ttaS = remainingM / speed;
  const talkMs = speechMs(text);
  const [closesS, windowOpensS] = rule.windowS;
  const opensS = Math.max(windowOpensS, talkMs / 1000 + SPEECH_MARGIN_S);
  if (ttaS < closesS || ttaS > opensS) return undefined;

  const expiresMs = Math.min(nowMs + rule.dropAfterS * 1000, nowMs + ttaS * 1000 - talkMs);
  if (expiresMs <= nowMs) return undefined;

  const curated = feature.source === 'curated' ? ', curated map data' : '';
  const reason =
    `${featureLabel(feature)} ${Math.round(remainingM)} m ahead at ${Math.round(speedMps)} m/s, ` +
    `about ${ttaS.toFixed(1)} s away${curated}`;
  return {
    ttaS,
    remainingM,
    cue: {
      id: `cue-${feature.id}-${pass}-${Math.round(nowMs)}`,
      featureId: feature.id,
      featureKind: feature.kind,
      text,
      reason,
      priority: rule.priority,
      earliestMs: nowMs,
      expiresMs,
    },
  };
}
