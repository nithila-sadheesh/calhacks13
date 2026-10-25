export function decodePcm(base64: string): Float32Array {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.length % 2) throw new Error('Incomplete PCM sample');
  const view = new DataView(bytes.buffer);
  return Float32Array.from(
    { length: bytes.length / 2 },
    (_, i) => view.getInt16(i * 2, true) / 32768,
  );
}

export function encodePcm(samples: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(samples.length * 2);
  const view = new DataView(bytes);
  samples.forEach((sample, i) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return bytes;
}

// Whole-utterance match only: a command word inside other speech ("do not mute") is ignored.
// A polite lead-in or trailing "please" is allowed around the phrase.
const COMMANDS = new Map<string, 'repeat' | 'mute' | 'unmute'>([
  ['repeat', 'repeat'],
  ['repeat that', 'repeat'],
  ['repeat it', 'repeat'],
  ['say that again', 'repeat'],
  ['say it again', 'repeat'],
  // How speech recognition often hears "repeat that": the first syllable drops out.
  ['keep that', 'repeat'],
  ['keep it', 'repeat'],
  ['beat that', 'repeat'],
  ['we beat that', 'repeat'],
  ['mute', 'mute'],
  ['unmute', 'unmute'],
]);

export function commandFromTranscript(text: string): 'repeat' | 'mute' | 'unmute' | undefined {
  const normalized = text
    .toLowerCase()
    .replace(/[.,!?]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:hey|okay|ok) )?(?:(?:can|could) you )?(?:please )?/, '')
    .replace(/ please$/, '');
  return COMMANDS.get(normalized);
}

// The "recording now" chime: 120 ms at 880 Hz, faded in and out so it does not click. Quiet at
// the source: playback adds about 10 dB (loudness.ts), which brings it to roughly -16 dBFS,
// well under speech.
export const CHIME_LEVEL = 0.05;
export function readyTone(sampleRate: number): Float32Array {
  const length = Math.round(sampleRate * 0.12);
  const fade = Math.round(sampleRate * 0.015);
  return Float32Array.from({ length }, (_, i) => {
    const envelope = Math.min(1, i / fade, (length - 1 - i) / fade);
    return CHIME_LEVEL * envelope * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
  });
}

// The wake word (and what speech recognition often makes of it) at the start of a transcript.
const WAKE_PREFIX =
  /^\s*(?:(?:hey|okay|ok)\s+)?(?:voya|voyah|voyer|boya|foya|voyage)\b[\s,.!?:;-]*/i;

export function stripWakeWord(text: string): string {
  return text.replace(WAKE_PREFIX, '');
}
