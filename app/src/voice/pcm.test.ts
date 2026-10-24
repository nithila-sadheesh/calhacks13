import { describe, expect, it } from 'vitest';
import { commandFromTranscript, decodePcm, encodePcm } from './pcm.ts';

describe('PCM transport', () => {
  it('decodes signed little-endian samples including negative full scale', () => {
    expect([...decodePcm('AIAAAP9/')]).toEqual([-1, 0, 32767 / 32768]);
  });
  it('clips microphone samples to the signed 16-bit range', () => {
    const view = new DataView(encodePcm(new Float32Array([-2, 0, 2])));
    expect([0, 2, 4].map((offset) => view.getInt16(offset, true))).toEqual([-32768, 0, 32767]);
  });
  it('rejects an incomplete sample', () => {
    expect(() => decodePcm('AA==')).toThrow();
  });
});

describe('push-to-talk commands', () => {
  it('normalizes the approved commands', () => {
    expect(commandFromTranscript('Repeat that!')).toBe('repeat');
    expect(commandFromTranscript(' Unmute. ')).toBe('unmute');
    expect(commandFromTranscript('Mute')).toBe('mute');
  });
  it('ignores unrelated speech and does not confuse unmute with mute', () => {
    expect(commandFromTranscript('do not mute')).toBeUndefined();
    expect(commandFromTranscript('turn left')).toBeUndefined();
  });
});
