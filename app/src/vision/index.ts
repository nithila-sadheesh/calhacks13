import type { AppModule, ModuleContext } from '../../../shared/types.ts';
import {
  adviceKey,
  parseCoachingResponse,
  type CoachingRequest,
  type CoachingResponse,
  type VideoFrame,
} from '../../../shared/coaching.ts';
import { createFrameCapture } from './capture.ts';
import { coachingStore } from './coachingStore.ts';

export const SAMPLE_MS = 1000;
export const ANALYSIS_INTERVAL_MS = 3000;
export const ADVICE_TTL_MS = 10_000;
export const MAX_RESPONSE_AGE_MS = 8000;
export const DUPLICATE_WINDOW_MS = 20_000;

async function analyze(input: CoachingRequest, signal: AbortSignal): Promise<CoachingResponse> {
  const response = await fetch('/api/vision-advice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? 'Anthropic key is not configured. Restart the dev server after setting it.'
        : `Video analysis unavailable (HTTP ${response.status}).`,
    );
  }
  const result = parseCoachingResponse(await response.json());
  if (!result) throw new Error('Video analysis returned an invalid coaching response.');
  return result;
}

export function createVisionModule(
  options: {
    capture?: (video: HTMLVideoElement, tripMs: number) => VideoFrame | undefined;
    analyze?: (input: CoachingRequest, signal: AbortSignal) => Promise<CoachingResponse>;
  } = {},
): AppModule {
  let cleanup: (() => void) | undefined;
  let sequence = 0;
  return {
    name: 'vision',
    async start(ctx: ModuleContext) {
      cleanup?.();
      const capture = options.capture ?? createFrameCapture();
      const request = options.analyze ?? analyze;
      let frames: VideoFrame[] = [];
      let lastSample: number | undefined;
      let lastRequest = -Infinity;
      let controller: AbortController | undefined;
      let version = 0;
      let stopped = false;
      const recent = new Map<string, { message: string; tripMs: number }>();
      coachingStore.reset();
      const reset = () => {
        version++;
        controller?.abort();
        controller = undefined;
        frames = [];
        lastSample = undefined;
        lastRequest = -Infinity;
        recent.clear();
        coachingStore.reset();
      };
      const off = [
        ctx.bus.on('tripReset', reset),
        ctx.bus.on('tripState', ({ state }) => {
          if (state !== 'playing') reset();
        }),
      ];
      const tick = () => {
        if (stopped || ctx.video.paused || ctx.video.ended) return;
        const tripMs = ctx.clock.nowMs();
        if (lastSample !== undefined && tripMs - lastSample < SAMPLE_MS) return;
        let frame: VideoFrame | undefined;
        try {
          frame = capture(ctx.video, tripMs);
        } catch {
          coachingStore.set({ status: 'error', error: 'Could not read the current video frame.' });
          return;
        }
        if (!frame) {
          coachingStore.set({ status: 'error', error: 'Waiting for playable video frames.' });
          return;
        }
        lastSample = tripMs;
        frames = [...frames, frame].slice(-3);
        if (controller || frames.length < 2 || tripMs - lastRequest < ANALYSIS_INTERVAL_MS) {
          if (!controller)
            coachingStore.set({
              ...coachingStore.get(),
              status: frames.length < 2 ? 'collecting' : coachingStore.get().status,
            });
          return;
        }
        const batch = frames.slice();
        const mine = version;
        const abort = new AbortController();
        controller = abort;
        lastRequest = tripMs;
        const started = performance.now();
        coachingStore.set({ ...coachingStore.get(), status: 'analyzing', error: undefined });
        for (const [key, value] of recent)
          if (tripMs - value.tripMs >= DUPLICATE_WINDOW_MS) recent.delete(key);
        const input = {
          frames: batch,
          recentAdvice: [...recent.values()].slice(-3).map((value) => value.message),
        };
        ctx.bus.emit('dataSent', {
          destination: 'anthropic-vision',
          summary: `${batch.length} resized video frames submitted for coaching; no GPS or microphone audio.`,
          tripMs,
        });
        void request(input, AbortSignal.any([abort.signal, AbortSignal.timeout(13_000)]))
          .then((raw) => {
            if (
              stopped ||
              version !== mine ||
              abort.signal.aborted ||
              ctx.video.paused ||
              ctx.video.ended
            )
              return;
            const now = ctx.clock.nowMs();
            if (now - tripMs > MAX_RESPONSE_AGE_MS) {
              coachingStore.set({
                status: 'collecting',
                reason: 'Previous analysis arrived too late; waiting for a fresh scene.',
              });
              return;
            }
            const result = parseCoachingResponse(raw);
            if (!result) throw new Error('Video analysis returned an invalid coaching response.');
            coachingStore.set({
              status: 'ready',
              message: result.shouldSpeak ? result.message : undefined,
              reason: result.reason,
              latencyMs: performance.now() - started,
              frameTripMs: tripMs,
            });
            if (!result.shouldSpeak) return;
            const key = adviceKey(result.message);
            if (recent.has(key)) return;
            recent.set(key, { message: result.message, tripMs: now });
            ctx.bus.emit('visionAdvice', {
              id: `vision-advice-${++sequence}`,
              text: result.message,
              reason: result.reason,
              tripMs,
              expiresMs: tripMs + ADVICE_TTL_MS,
            });
          })
          .catch((error: unknown) => {
            if (!stopped && version === mine && !abort.signal.aborted)
              coachingStore.set({
                status: 'error',
                error: error instanceof Error ? error.message : 'Video analysis unavailable.',
              });
          })
          .finally(() => {
            if (controller === abort) controller = undefined;
          });
      };
      const timer = setInterval(tick, 100);
      cleanup = () => {
        stopped = true;
        reset();
        clearInterval(timer);
        off.forEach((dispose) => dispose());
      };
    },
    stop() {
      cleanup?.();
      cleanup = undefined;
    },
  };
}
export const visionModule = createVisionModule();
