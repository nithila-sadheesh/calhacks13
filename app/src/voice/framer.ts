// Resamples microphone chunks (Float32 at the capture rate, usually 48 kHz) to the 16 kHz the
// wake-word features use. Each output sample is the average of the input samples it covers, a box
// filter that keeps speech and drops the content above the new Nyquist limit well enough for
// keyword spotting.

export function createResampler(fromRate: number, toRate: number) {
  const ratio = fromRate / toRate;
  let pending: number[] = [];
  let position = 0; // fractional index into `pending` where the next output sample starts

  return {
    push(samples: Float32Array): Float32Array {
      for (const s of samples) pending.push(s);
      const out: number[] = [];
      while (position + ratio <= pending.length) {
        const start = Math.floor(position);
        const end = Math.max(start + 1, Math.floor(position + ratio));
        let sum = 0;
        for (let i = start; i < end; i++) sum += pending[i]!;
        out.push(sum / (end - start));
        position += ratio;
      }
      // Drop consumed input, keeping the fractional position.
      const consumed = Math.floor(position);
      pending = pending.slice(consumed);
      position -= consumed;
      return Float32Array.from(out);
    },
  };
}
