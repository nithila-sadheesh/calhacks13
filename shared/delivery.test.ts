import { expect, it } from 'vitest';
import {
  DELIVERY_EMOTIONS,
  DELIVERY_GUIDE,
  DELIVERY_PROPERTIES,
  DELIVERY_SCHEMA,
  MAX_DELIVERY_SPEED,
  MAX_DELIVERY_VOLUME,
  MIN_DELIVERY_SPEED,
  MIN_DELIVERY_VOLUME,
  parseDelivery,
} from './delivery.ts';

it('keeps emotion and pace replies valid and adds bounded speed and volume', () => {
  expect(parseDelivery({ emotion: 'calm', pace: 'slower' })).toEqual({
    emotion: 'calm',
    pace: 'slower',
  });
  expect(parseDelivery({ emotion: 'determined', pace: 'normal', speed: 1.1, volume: 1.2 })).toEqual(
    { emotion: 'determined', pace: 'normal', speed: 1.1, volume: 1.2 },
  );
  expect(parseDelivery({ emotion: 'curious' })).toEqual({ emotion: 'curious', pace: 'normal' });
});

it('rejects unknown emotions and speed or volume outside the safe band', () => {
  expect(parseDelivery({ emotion: 'panicked', pace: 'normal' })).toBeUndefined();
  expect(parseDelivery({ emotion: 'calm', speed: MAX_DELIVERY_SPEED + 0.05 })).toBeUndefined();
  expect(parseDelivery({ emotion: 'calm', speed: MIN_DELIVERY_SPEED - 0.05 })).toBeUndefined();
  expect(parseDelivery({ emotion: 'calm', volume: MAX_DELIVERY_VOLUME + 0.05 })).toBeUndefined();
  expect(parseDelivery({ emotion: 'calm', volume: MIN_DELIVERY_VOLUME - 0.05 })).toBeUndefined();
  expect(parseDelivery({ emotion: 'calm', speed: '1.1' })).toBeUndefined();
  expect(parseDelivery(null)).toBeUndefined();
});

it('offers Claude only values that parse, and documents every emotion', () => {
  expect(DELIVERY_SCHEMA.required).toEqual(['emotion', 'pace', 'speed', 'volume']);
  for (const speed of DELIVERY_PROPERTIES.speed.enum)
    for (const volume of DELIVERY_PROPERTIES.volume.enum)
      expect(parseDelivery({ emotion: 'calm', pace: 'normal', speed, volume })).toBeDefined();
  for (const emotion of DELIVERY_EMOTIONS) expect(DELIVERY_GUIDE).toContain(`"${emotion}"`);
});
