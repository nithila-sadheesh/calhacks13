import type { Bus, SpeakRequest, TripClock } from '../../../shared/types.ts';
import { approvedText, CLIP_TEXT, fallbackKey, type ClipKey } from './config.ts';
import type { AudioPlayer, Playback } from './player.ts';
import type { SonicMessage, SonicTransport } from './sonic.ts';

type Active = {
  request: SpeakRequest;
  context: string;
  received: number;
  started: boolean;
  playback: Set<Playback>;
  done: boolean;
  local: boolean;
  receivedAudio: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
export function createVoiceEngine(options: {
  bus: Bus;
  clock: TripClock;
  player: AudioPlayer;
  clips: Map<ClipKey, Float32Array>;
  transport: (receive: (m: SonicMessage) => void, disconnect: () => void) => SonicTransport;
  latencyNow?: () => number;
}) {
  const { bus, clock, player, clips } = options;
  const latencyNow = options.latencyNow ?? (() => performance.now());
  let active: Active | undefined;
  let stopped = false;
  function finish(item: Active, interrupted: boolean) {
    if (active !== item) return;
    active = undefined;
    clearTimeout(item.timer);
    for (const playback of item.playback) playback.stop();
    item.playback.clear();
    if (!item.local) transport.cancel(item.context);
    bus.emit('speechEnded', { id: item.request.id, interrupted });
  }
  function play(item: Active, samples: Float32Array) {
    if (!samples.length || active !== item) return;
    const node = player.play(
      samples,
      (audibleAt) => {
        if (active !== item || item.started) return;
        item.started = true;
        bus.emit('speechStarted', {
          id: item.request.id,
          firstAudibleMs: Math.max(0, (audibleAt ?? latencyNow()) - item.received),
        });
      },
      () => {
        item.playback.delete(node);
        if (active === item && item.done && !item.playback.size) finish(item, false);
      },
    );
    item.playback.add(node);
  }
  function fallback(item: Active) {
    if (active !== item || item.local) return;
    transport.cancel(item.context);
    clearTimeout(item.timer);
    for (const node of item.playback) node.stop();
    item.playback.clear();
    item.local = true;
    item.done = true;
    if (item.request.expiresMs !== undefined && clock.nowMs() > item.request.expiresMs) {
      finish(item, false);
      return;
    }
    const key = fallbackKey(item.request.text);
    const samples = key && clips.get(key);
    if (!samples) {
      finish(item, false);
      return;
    }
    play(item, samples);
  }
  const transport = options.transport(
    (message) => {
      const item = active;
      if (!item || item.local || message.id !== item.context) return;
      if (message.type === 'error') {
        fallback(item);
        return;
      }
      if (message.type === 'done') {
        item.done = true;
        clearTimeout(item.timer);
        if (!item.playback.size) {
          if (item.receivedAudio) finish(item, false);
          else fallback(item);
        }
      } else {
        if (!message.samples.length) return;
        item.receivedAudio = true;
        clearTimeout(item.timer);
        if (!player.ready()) {
          finish(item, false);
          return;
        }
        if (
          item.request.expiresMs !== undefined &&
          clock.nowMs() > item.request.expiresMs &&
          !item.started
        ) {
          finish(item, false);
          return;
        }
        play(item, message.samples);
        // A stalled mid-stream connection must not leave the arbiter waiting forever.
        item.timer = setTimeout(() => fallback(item), 5000);
      }
    },
    () => {
      if (active && !active.local) fallback(active);
    },
  );
  return {
    speak(request: SpeakRequest) {
      if (stopped) return;
      if (
        !approvedText(request.text) ||
        !player.ready() ||
        (request.expiresMs !== undefined && clock.nowMs() > request.expiresMs)
      ) {
        bus.emit('speechEnded', { id: request.id, interrupted: false });
        return;
      }
      if (active) {
        if (request.priority !== 0 || active.request.priority === 0) {
          bus.emit('speechEnded', { id: request.id, interrupted: false });
          return;
        }
        finish(active, true);
      }
      const item: Active = {
        request,
        context: crypto.randomUUID(),
        received: latencyNow(),
        started: false,
        playback: new Set(),
        done: false,
        local: false,
        receivedAudio: false,
      };
      active = item;
      if (request.clipKey || request.priority === 0) {
        const key = (request.clipKey as ClipKey | undefined) ?? fallbackKey(request.text);
        const samples = key && CLIP_TEXT[key] === request.text && clips.get(key);
        item.local = true;
        item.done = true;
        if (samples) play(item, samples);
        else finish(item, false);
        return;
      }
      item.timer = setTimeout(() => fallback(item), 1500);
      void transport.send(item.context, request.text).catch(() => fallback(item));
    },
    reset() {
      if (active) finish(active, true);
    },
    stop() {
      stopped = true;
      if (active) finish(active, true);
      transport.close();
      player.close();
    },
  };
}
