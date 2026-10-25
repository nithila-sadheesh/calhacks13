import type { Delivery, DeliveryEmotion } from './types.ts';

export const DELIVERY_EMOTIONS: readonly DeliveryEmotion[] = [
  'calm',
  'confident',
  'content',
  'sympathetic',
];
export const DELIVERY_PACES: readonly Delivery['pace'][] = ['normal', 'slower'];
export const MIN_DELIVERY_SPEED = 0.8;
export const MAX_DELIVERY_SPEED = 1.15;
export const MIN_DELIVERY_VOLUME = 0.85;
export const MAX_DELIVERY_VOLUME = 1.1;
export const DELIVERY_SCHEMA = {
  type: 'object',
  properties: {
    emotion: { type: 'string', enum: DELIVERY_EMOTIONS },
    pace: { type: 'string', enum: DELIVERY_PACES },
    speed: { type: 'number', enum: [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15] },
    volume: { type: 'number', enum: [0.85, 0.9, 0.95, 1, 1.05, 1.1] },
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
