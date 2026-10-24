import { describe, expect, it } from 'vitest';
import { enterCaptureSession, enterPlaybackSession } from './audioSession.ts';

describe('WebKit audio session', () => {
  it('plays under playback, captures under play-and-record, then restores playback', () => {
    const nav = { audioSession: { type: 'auto' } };
    enterPlaybackSession(nav);
    expect(nav.audioSession.type).toBe('playback');
    const restore = enterCaptureSession(nav);
    expect(nav.audioSession.type).toBe('play-and-record');
    restore();
    restore();
    expect(nav.audioSession.type).toBe('playback');
  });

  it('does nothing in browsers without the API', () => {
    expect(() => enterPlaybackSession({})).not.toThrow();
    expect(() => enterCaptureSession({})()).not.toThrow();
  });
});
