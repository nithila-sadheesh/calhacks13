import { describe, expect, it } from 'vitest';
import { isSafeToSpeak, MAX_SPOKEN_CHARS, unsafeReason } from './safeWording.ts';

describe('safe wording', () => {
  it.each([
    'Stop sign in about 80 meters on Oxford Street. Plan a full stop.',
    'Your last reminder was about the crosswalk ahead.',
    'Left turn onto Center Street coming up. Check for pedestrians first.',
    'I warned you because a person was in the road ahead.',
    'Traffic light ahead. Be ready to stop.',
  ])('allows %s', (line) => {
    expect(isSafeToSpeak(line)).toBe(true);
  });

  it.each([
    ['Brake now!', 'braking instruction'],
    ['Start braking for the car ahead.', 'braking instruction'],
    ['The intersection is clear.', 'says the way is clear'],
    ['Looks clear, you can go.', 'says the way is clear'],
    ['It is safe to turn left.', 'tells the driver to go'],
    ['Go ahead, nobody is coming.', 'tells the driver to go'],
    ['You have the right of way here.', 'decides right-of-way'],
    ['The light is green.', 'states a light color'],
    ['Red light ahead.', 'states a light color'],
    ['You could crash in two seconds.', 'collision timing'],
    ['The speed limit here is 25.', 'asserts a speed limit'],
  ])('blocks %s', (line, reason) => {
    expect(unsafeReason(line)).toBe(reason);
  });

  it('blocks empty and over-long lines', () => {
    expect(unsafeReason('  ')).toBe('empty');
    expect(unsafeReason('a'.repeat(MAX_SPOKEN_CHARS + 1))).toBe('too long to speak');
  });
});
