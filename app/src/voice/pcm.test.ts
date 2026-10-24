import { describe, expect, it } from 'vitest';
import { commandFromTranscript, decodePcm, encodePcm, readyTone } from './pcm.ts';

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
    expect(commandFromTranscript('constructor')).toBeUndefined();
  });
  it('tolerates Ink segment spacing and polite phrasing', () => {
    expect(commandFromTranscript('repeat  that.')).toBe('repeat');
    expect(commandFromTranscript('Can you repeat that, please?')).toBe('repeat');
    expect(commandFromTranscript('Say that again.')).toBe('repeat');
    expect(commandFromTranscript('Okay, mute.')).toBe('mute');
    expect(commandFromTranscript('Please unmute')).toBe('unmute');
    expect(commandFromTranscript('can you not mute')).toBeUndefined();
  });
});

describe('ready chime', () => {
  it('is a short, quiet tone that starts and ends at silence', () => {
    const tone = readyTone(24000);
    expect(tone.length).toBe(2880);
    expect(Math.max(...tone.map(Math.abs))).toBeLessThanOrEqual(0.25);
    expect(tone[0]).toBe(0);
    expect(Math.abs(tone.at(-1)!)).toBeLessThan(0.001);
  });
});
