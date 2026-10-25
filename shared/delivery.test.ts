import { expect, it } from 'vitest';
import { parseDelivery } from './delivery.ts';
it('preserves per-sentence delivery and accepts older emotion/pace replies', () => {
  const delivery = { emotion: 'sympathetic', pace: 'slower', speed: 0.85, volume: 0.9 };
  expect(parseDelivery(delivery)).toEqual(delivery);
  expect(parseDelivery({ emotion: 'confident', pace: 'normal' })).toEqual({
    emotion: 'confident',
    pace: 'normal',
  });
});
it('rejects unsafe or malformed controls and strips model/format identifiers', () => {
  const base = { emotion: 'calm', pace: 'normal' };
  for (const value of [
    { speed: 2 },
    { speed: NaN },
    { speed: 'fast' },
    { volume: 0.1 },
    { volume: Infinity },
    { emotion: 'panicked' },
  ])
    expect(parseDelivery({ ...base, ...value })).toBeUndefined();
  expect(
    parseDelivery({
      ...base,
      model_id: 'invented',
      sample_rate: 123,
      pronunciation_dict_id: 'invented',
    }),
  ).toEqual(base);
});
