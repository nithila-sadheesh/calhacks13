export type CaptureSession = { sampleRate: number; stop(): void };
export async function openCapture(
  onSamples: (samples: Float32Array) => void,
  signal: AbortSignal,
): Promise<CaptureSession> {
  const context = new AudioContext({ sampleRate: 48000 });
  // Request resume in the originating pointer/key gesture, before any permission wait.
  const resumed = context.resume();
  void resumed.catch(() => {});
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
    if (node) {
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
    }
    source?.disconnect();
    if (context.state !== 'closed') void context.close().catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    // Permission prompts cannot be cancelled; stop tracks if release happened meanwhile.
    if (signal.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Capture cancelled');
    }
    await resumed;
    await context.audioWorklet.addModule(new URL('./captureWorklet.js?no-inline', import.meta.url));
    signal.throwIfAborted();
    node = new AudioWorkletNode(context, 'voice-capture');
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!stopped && !signal.aborted && event.data instanceof Float32Array) onSamples(event.data);
    };
    source = context.createMediaStreamSource(stream);
    source.connect(node);
    node.connect(context.destination);
    return {
      sampleRate: context.sampleRate,
      stop: () => {
        signal.removeEventListener('abort', stop);
        stop();
      },
    };
  } catch (error: unknown) {
    stop();
    signal.removeEventListener('abort', stop);
    throw error;
  }
}
