import { expect, it } from 'vitest';
import { rememberScene, selectCoachingFrames } from './sceneMemory.ts';
import { parseSceneMemory, type CoachingResponse } from '../../../shared/coaching.ts';
const result: CoachingResponse = {
  shouldSpeak: false,
  message: '',
  reason: 'Uncertain chronology.',
  observations: ['A car is already stopped.'],
  uncertainties: ['Its arrival was not observed.'],
  coachingPoint: 'Preserve missing evidence.',
  sceneChanged: false,
};
it('selects an earlier anchor plus two recent frames without changing timestamps', () => {
  const frames = Array.from({ length: 21 }, (_, i) => ({ tripMs: i * 1000, jpeg: '/9j/AA==' }));
  expect(selectCoachingFrames(frames).map((frame) => frame.tripMs)).toEqual([10000, 19000, 20000]);
  expect(selectCoachingFrames(frames.slice(0, 2))).toEqual(frames.slice(0, 2));
});
it('bounds observation history and preserves uncertainty instead of inventing arrival order', () => {
  let memory = rememberScene([], result, 1000);
  expect(memory[0]?.uncertainties).toEqual(['Its arrival was not observed.']);
  for (let i = 2; i < 8; i++) memory = rememberScene(memory, result, i * 1000);
  expect(memory).toHaveLength(4);
  expect(rememberScene(memory, result, 30000)).toHaveLength(1);
  expect(rememberScene(memory, { ...result, sceneChanged: true }, 9000)).toHaveLength(1);
});
it('rejects future, excessive or malformed scene memory', () => {
  const memory = rememberScene([], result, 1000);
  expect(parseSceneMemory(memory, 2000)).toEqual(memory);
  expect(parseSceneMemory(memory, 500)).toBeUndefined();
  expect(parseSceneMemory(memory, 22000)).toBeUndefined();
  expect(parseSceneMemory([...memory, ...memory], 2000)).toBeUndefined();
  expect(
    parseSceneMemory([{ tripMs: 1000, observations: ['a'.repeat(161)], uncertainties: [] }], 2000),
  ).toBeUndefined();
});
