import type { Delivery, DeliveryEmotion } from './types.ts';

export const DELIVERY_EMOTIONS: readonly DeliveryEmotion[] = [
  'calm',
  'confident',
  'content',
  'sympathetic',
  'neutral',
  'curious',
  'determined',
  'peaceful',
  'contemplative',
  'grateful',
  'enthusiastic',
];
export const DELIVERY_PACES: readonly Delivery['pace'][] = ['normal', 'slower'];
// Inside Sonic 3's accepted 0.6-1.5 speed and 0.5-2.0 volume, kept to a band that never sounds
// rushed or shouted, but wide enough that per-sentence choices are audible.
export const MIN_DELIVERY_SPEED = 0.75;
export const MAX_DELIVERY_SPEED = 1.3;
export const MIN_DELIVERY_VOLUME = 0.75;
export const MAX_DELIVERY_VOLUME = 1.25;
const steps = (min: number, max: number) =>
  Array.from({ length: Math.round((max - min) / 0.05) + 1 }, (_, i) =>
    Number((min + i * 0.05).toFixed(2)),
  );
export const DELIVERY_SCHEMA = {
  type: 'object',
  properties: {
    emotion: { type: 'string', enum: DELIVERY_EMOTIONS },
    pace: { type: 'string', enum: DELIVERY_PACES },
    speed: { type: 'number', enum: steps(MIN_DELIVERY_SPEED, MAX_DELIVERY_SPEED) },
    volume: { type: 'number', enum: steps(MIN_DELIVERY_VOLUME, MAX_DELIVERY_VOLUME) },
  },
  required: ['emotion', 'pace', 'speed', 'volume'],
  additionalProperties: false,
};

// Older replies with only emotion/pace remain valid. Out-of-bounds controls never reach Sonic.
export function parseDelivery(value: unknown): Delivery | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const item = value as Record<string, unknown>;
  const emotion = DELIVERY_EMOTIONS.find((e) => e === item.emotion);
  if (!emotion) return;
  const result: Delivery = {
    emotion,
    pace: DELIVERY_PACES.find((p) => p === item.pace) ?? 'normal',
  };
  for (const [key, min, max] of [
    ['speed', MIN_DELIVERY_SPEED, MAX_DELIVERY_SPEED],
    ['volume', MIN_DELIVERY_VOLUME, MAX_DELIVERY_VOLUME],
  ] as const) {
    const number = item[key];
    if (number === undefined) continue;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max)
      return;
    result[key] = number;
  }
  return result;
}

// One delivery guide for every Claude prompt that writes speech, so vision coaching, answers and
// route wording choose Sonic settings the same way. Model, voice, sample rate and pronunciation
// dictionary stay fixed application configuration.
export const DELIVERY_GUIDE = `Claude directs the voice: every spoken sentence carries its own Sonic generation_config (emotion, speed, volume) plus pace. Choose them from what this exact sentence says, so consecutive lines do not all sound alike. Do not default to calm/1.0/1.0.
Emotion (one value):
- "confident": a concrete, practical check or habit ("Check your mirror and blind spot").
- "determined": a firm preparation cue where focus matters, such as a stop sign, crossing or a vulnerable road user nearby. Firm, not alarmed.
- "curious": inviting the learner to look or think ("Notice how that van hides the pavement").
- "contemplative": a reflective "why it matters" explanation.
- "calm": a measured observation, anything soon after a camera alert, and whenever unsure.
- "neutral": plain factual information such as what is coming up or what was said.
- "peaceful": settling the learner after something busy has passed.
- "sympathetic": the learner sounds nervous, upset or says they made a mistake.
- "content": light, friendly lines and confirmations.
- "grateful": the learner thanks you.
- "enthusiastic": praise when the learner says something went well. Warm, never over the top.
Speed (${MIN_DELIVERY_SPEED}-${MAX_DELIVERY_SPEED}, steps of 0.05): 1.1-1.2 for a short cue of under ten words; 1.0-1.05 for an ordinary sentence; 0.85-0.95 for an explanation or a sentence with several parts; 0.75-0.85 for reassurance or when the learner did not understand.
Volume (${MIN_DELIVERY_VOLUME}-${MAX_DELIVERY_VOLUME}, steps of 0.05): 1.1-1.2 for a preparation cue that must be heard over road noise; 1.0-1.05 for ordinary speech; 0.8-0.9 for reassurance or quiet encouragement. Never shout.
Pace: "slower" only for reassurance or when the learner asked for clarity; otherwise "normal".
Never use delivery to signal danger or urgency. Real warnings come from bundled camera alerts, not generated speech.`;
