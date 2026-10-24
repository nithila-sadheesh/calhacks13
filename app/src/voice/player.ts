import { SAMPLE_RATE } from './config.ts';
import { createLoudnessChain } from './loudness.ts';

export type Playback = { stop(): void };
export type AudioPlayer = {
  ready(): boolean;
  enable(): Promise<void>;
  play(
    samples: Float32Array,
    onStart: (performanceMs?: number) => void,
    onEnd: () => void,
  ): Playback;
  close(): void;
};

export function createAudioPlayer(): AudioPlayer {
  const context = new AudioContext();
  const output = createLoudnessChain(context);
  const playing = new Set<Playback>();
  let nextTime = 0;
  return {
    ready: () => context.state === 'running',
    enable: () => context.resume(),
    play(samples, onStart, onEnd) {
      const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(Float32Array.from(samples), 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      const start = Math.max(context.currentTime + 0.015, nextTime);
      nextTime = start + buffer.duration;
      let timer: ReturnType<typeof setTimeout>;
      let stopped = false;
      const notify = () => {
        if (stopped) return;
        // Output timestamp follows the device's rendered audio, not received network chunks.
        const timestamp = context.getOutputTimestamp?.();
        const rendered = timestamp?.contextTime ?? context.currentTime;
        if (rendered >= start) {
          const audibleAt =
            typeof timestamp?.performanceTime === 'number' &&
            typeof timestamp.contextTime === 'number' &&
            timestamp.performanceTime > 0
              ? timestamp.performanceTime + (start - timestamp.contextTime) * 1000
              : performance.now();
          onStart(audibleAt);
        } else timer = setTimeout(notify, 5);
      };
      const playback: Playback = {
        stop() {
          if (stopped) return;
          stopped = true;
          clearTimeout(timer);
          source.onended = null;
          source.stop();
          source.disconnect();
          playing.delete(playback);
          if (!playing.size) nextTime = context.currentTime;
        },
      };
      source.onended = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        source.disconnect();
        playing.delete(playback);
        if (!playing.size) nextTime = context.currentTime;
        onEnd();
      };
      playing.add(playback);
      source.start(start);
      timer = setTimeout(notify, 5);
      return playback;
    },
    close() {
      for (const item of [...playing]) item.stop();
      void context.close();
    },
  };
}
