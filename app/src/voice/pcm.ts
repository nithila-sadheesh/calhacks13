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

// The "recording now" chime: 120 ms at 880 Hz, faded in and out so it does not click.
export function readyTone(sampleRate: number): Float32Array {
  const length = Math.round(sampleRate * 0.12);
  const fade = Math.round(sampleRate * 0.015);
  return Float32Array.from({ length }, (_, i) => {
    const envelope = Math.min(1, i / fade, (length - 1 - i) / fade);
    return 0.25 * envelope * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
  });
}
