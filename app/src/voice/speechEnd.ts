// Decides when a hands-free request is over, from the microphone audio itself (there is no second
// tap). Loudness is measured per chunk against a noise floor: the quietest chunk of the last
// FLOOR_WINDOW_MS. Speech always has gaps between words, so this follows the background (road
// noise included) even when the speaker is already talking as recording starts. The request has
// ended after END_OF_SPEECH_MS of quiet that follows some voice, or NO_SPEECH_MS with no voice.

export const END_OF_SPEECH_MS = 1500;
export const NO_SPEECH_MS = 5000;
// The "speak now" chime plays as recording starts; it must not count as the speaker's voice.
export const IGNORE_FIRST_MS = 300;
// Voice must be this loud in absolute terms, and this many times the noise floor.
const MIN_VOICE_RMS = 0.01;
const FLOOR_RATIO = 3;
const FLOOR_WINDOW_MS = 2000;
const MIN_FLOOR = 0.0005;

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

export function createSpeechTracker(nowMs: () => number) {
  let startedAt: number | undefined;
  let lastVoiceAt: number | undefined;
  const levels: Array<{ t: number; level: number }> = [];

  return {
    push(samples: Float32Array) {
      const t = nowMs();
      startedAt ??= t;
      const level = rms(samples);
      levels.push({ t, level });
      while (levels.length > 1 && t - levels[0]!.t > FLOOR_WINDOW_MS) levels.shift();
      if (t - startedAt < IGNORE_FIRST_MS) return;
      let floor = Infinity;
      for (const l of levels) floor = Math.min(floor, l.level);
      if (level > Math.max(MIN_VOICE_RMS, Math.max(floor, MIN_FLOOR) * FLOOR_RATIO))
        lastVoiceAt = t;
    },
    heard: () => lastVoiceAt !== undefined,
    // True once the request is over: a pause after speech, or nobody spoke at all.
    ended(): boolean {
      if (startedAt === undefined) return false;
      const t = nowMs();
      if (lastVoiceAt === undefined) return t - startedAt >= NO_SPEECH_MS;
      return t - lastVoiceAt >= END_OF_SPEECH_MS;
    },
  };
}
