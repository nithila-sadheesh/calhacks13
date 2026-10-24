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

export function commandFromTranscript(text: string): 'repeat' | 'mute' | 'unmute' | undefined {
  const normalized = text
    .toLowerCase()
    .replace(/[.,!?]/g, '')
    .trim();
  if (normalized === 'repeat that' || normalized === 'repeat') return 'repeat';
  if (normalized === 'mute' || normalized === 'unmute') return normalized;
  return undefined;
}
