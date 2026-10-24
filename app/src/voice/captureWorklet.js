/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// About 20 ms per message, limiting unsent audio at release. The output stays silent: the mic is never monitored.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(Math.round(sampleRate / 50));
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.chunk[this.offset++] = sample;
      if (this.offset === this.chunk.length) {
        this.port.postMessage(this.chunk, [this.chunk.buffer]);
        this.chunk = new Float32Array(Math.round(sampleRate / 50));
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', CaptureProcessor);
