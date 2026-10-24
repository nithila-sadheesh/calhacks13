// Makes speech louder on small phone speakers without clipping. Sonic output and the bundled clips
// peak near full scale but average about -18 dBFS, so plain gain clips. Instead: gentle
// compression, make-up gain, then a soft clipper that rounds off the remaining peaks. Measured on
// all bundled clips in Chrome and WebKit: -18.1 -> -10.3 dBFS average, peaks at most -0.9 dBFS.
// (Sonic's own `volume` setting hard-clips at 1.5 and above, and does not cover the clips.)

export const MAKEUP_DB = 10;
const KNEE_START = 0.6; // below this the soft clipper is linear

// Linear up to KNEE_START, then a tanh shoulder with slope 1 at the knee (no kink, no boost of
// peaks) that tops out at KNEE_START + shoulder * tanh(1), about 0.9 of full scale.
export function softClipCurve(size = 2048): Float32Array {
  const shoulder = 1 - KNEE_START;
  return Float32Array.from({ length: size }, (_, i) => {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    if (a < KNEE_START) return x;
    return Math.sign(x) * (KNEE_START + shoulder * Math.tanh((a - KNEE_START) / shoulder));
  });
}

type LoudnessContext = Pick<
  BaseAudioContext,
  'createDynamicsCompressor' | 'createGain' | 'createWaveShaper' | 'destination'
>;

// Returns the node every playback source connects to.
export function createLoudnessChain(context: LoudnessContext): AudioNode {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  const gain = context.createGain();
  gain.gain.value = 10 ** (MAKEUP_DB / 20);
  const clipper = context.createWaveShaper();
  clipper.curve = softClipCurve() as Float32Array<ArrayBuffer>;
  // Oversampling's filter overshoots full scale; speech needs none.
  clipper.oversample = 'none';
  compressor.connect(gain);
  gain.connect(clipper);
  clipper.connect(context.destination);
  return compressor;
}
