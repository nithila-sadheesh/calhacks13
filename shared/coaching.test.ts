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
