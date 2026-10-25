import { expect, it } from 'vitest';
import {
  adviceKey,
  parseCoachingRequest,
  parseCoachingResponse,
  validCoachingText,
} from './coaching.ts';
it('validates speech and silence without inventing output', () => {
  expect(
    parseCoachingResponse({ shouldSpeak: false, message: '', reason: 'No new observation.' })
      ?.shouldSpeak,
  ).toBe(false);
  expect(
    parseCoachingResponse({
      shouldSpeak: true,
      message: 'Watch for pedestrians near parked vehicles.',
      reason: 'People beside cars.',
    }),
  ).toBeDefined();
  for (const message of [
    '',
    'Go now.',
    'It is safe to turn.',
    'Brake immediately.',
    'a'.repeat(181),
    'Check\nmirrors.',
  ])
    expect(validCoachingText(message)).toBe(false);
  expect(
    parseCoachingResponse({ shouldSpeak: false, message: 'Talk anyway', reason: '' }),
  ).toBeUndefined();
});
it('validates frame count, image format and increasing replay timestamps', () => {
  const input = {
    frames: [
      { tripMs: 0, jpeg: '/9j/AA==' },
      { tripMs: 1000, jpeg: '/9j/AA==' },
    ],
    recentAdvice: [],
  };
  expect(parseCoachingRequest(input)).toEqual(input);
  expect(parseCoachingRequest({ ...input, frames: [input.frames[0]] })).toBeUndefined();
  expect(
    parseCoachingRequest({ ...input, frames: [input.frames[0], input.frames[0]] }),
  ).toBeUndefined();
  expect(
    parseCoachingRequest({
      ...input,
      frames: [{ tripMs: NaN, jpeg: 'data:image/jpeg' }, input.frames[1]],
    }),
  ).toBeUndefined();
  expect(parseCoachingRequest({ ...input, recentAdvice: ['Go now.'] })).toBeUndefined();
  expect(adviceKey('Check your mirrors!')).toBe(adviceKey('check your mirrors.'));
});

it('preserves bounded structured observations and rejects incomplete evidence fields', () => {
  const value = {
    shouldSpeak: false,
    message: '',
    reason: 'Arrival order is unknown.',
    observations: ['A car is waiting.'],
    uncertainties: ['Arrival was not observed.'],
    coachingPoint: 'Do not infer arrival from first visibility.',
    sceneChanged: false,
  };
  expect(parseCoachingResponse(value)).toEqual(value);
  expect(parseCoachingResponse({ ...value, observations: ['a'.repeat(161)] })).toBeUndefined();
  expect(parseCoachingResponse({ ...value, sceneChanged: 'no' })).toBeUndefined();
  expect(
    parseCoachingResponse({ shouldSpeak: false, message: '', reason: '', observations: [] }),
  ).toBeUndefined();
});

it("keeps Claude's delivery with spoken coaching and drops it from silence or when malformed", () => {
  const base = {
    shouldSpeak: true,
    message: 'Stop sign ahead; prepare for a complete stop.',
    reason: 'Sign.',
  };
  const delivery = { emotion: 'determined', pace: 'normal', speed: 1.1, volume: 1.15 };
  expect(parseCoachingResponse({ ...base, delivery })?.delivery).toEqual(delivery);
  expect(parseCoachingResponse({ ...base, delivery: { emotion: 'angry' } })).toEqual(base);
  expect(
    parseCoachingResponse({ shouldSpeak: false, message: '', reason: 'Quiet.', delivery })
      ?.delivery,
  ).toBeUndefined();
});

it('passes quiet time to the server only when it is a sane number', () => {
  const scene = { tripMs: 5000, objects: [] };
  expect(parseCoachingRequest({ scene, recentAdvice: [], quietForMs: 12345.6 })?.quietForMs).toBe(
    12346,
  );
  for (const quietForMs of [-1, Number.NaN, '5000', 4_000_000])
    expect(parseCoachingRequest({ scene, recentAdvice: [], quietForMs })).toEqual({
      scene,
      previousScenes: [],
      recentAdvice: [],
    });
});
