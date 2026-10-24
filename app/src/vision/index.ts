import type { AppModule, ModuleContext } from '../../../shared/types.ts';
import {
  adviceKey,
  parseCoachingResponse,
  SCENE_MEMORY_MS,
  type CoachingRequest,
  type CoachingResponse,
  type SceneMemory,
} from '../../../shared/coaching.ts';
import type { CvScene } from '../../../shared/cvScene.ts';
import { loadDetector, type VisionDetector } from './detector.ts';
import { createTracker, type Track } from './tracker.ts';
import { createSceneBuilder, sceneKey } from './cvScene.ts';
import { rememberScene } from './sceneMemory.ts';
import { coachingStore } from './coachingStore.ts';

export const CV_INTERVAL_MS = 125;
export const ANALYSIS_INTERVAL_MS = 3000;
export const SCENE_REFRESH_MS = 5000;
export const MAX_RESPONSE_AGE_MS = 8000;
export const ADVICE_TTL_MS = 10000;

async function analyze(input: CoachingRequest, signal: AbortSignal): Promise<CoachingResponse> {
  const response = await fetch('/api/vision-advice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 503
        ? 'Anthropic key is not configured. Restart the server after setting it.'
        : `Coaching unavailable (HTTP ${response.status}).`,
    );
  const result = parseCoachingResponse(await response.json());
  if (!result) throw new Error('Coaching response was invalid.');
  return result;
}

export function createVisionModule(
  options: {
    loadDetector?: () => Promise<VisionDetector>;
    analyze?: (input: CoachingRequest, signal: AbortSignal) => Promise<CoachingResponse>;
  } = {},
): AppModule {
  let cleanup: (() => void) | undefined;
  let sequence = 0;
  return {
    name: 'vision',
    async start(ctx: ModuleContext) {
      cleanup?.();
      const tracker = createTracker();
      const builder = createSceneBuilder();
      let detector: VisionDetector | undefined;
      let loadFailed = false;
      let stopped = false;
      let version = 0;
      let detectorMs = 0;
      let lastTripMs: number | undefined;
      let lastRequestMs = -Infinity;
      let lastSentKey: string | undefined;
      let controller: AbortController | undefined;
      let sceneMemory: SceneMemory[] = [];
      let previousScenes: CvScene[] = [];
      const recent = new Map<string, number>();
      let framesProcessed = 0;
      coachingStore.set({ status: 'loadingCv' });
      const reset = () => {
        version++;
        controller?.abort();
        controller = undefined;
        tracker.reset();
        builder.reset();
        sceneMemory = [];
        previousScenes = [];
        recent.clear();
        lastTripMs = undefined;
        lastRequestMs = -Infinity;
        lastSentKey = undefined;
        framesProcessed = 0;
        if (!stopped)
          coachingStore.set({
            status: detector ? 'watching' : loadFailed ? 'error' : 'loadingCv',
            error: loadFailed
              ? 'Local object detector is unavailable. Reload to retry.'
              : undefined,
            cvScene: undefined,
          });
      };
      const off = [
        ctx.bus.on('tripReset', reset),
        ctx.bus.on('tripState', ({ state }) => {
          if (state !== 'playing') reset();
        }),
      ];
      const timer: { current?: ReturnType<typeof setInterval> } = {};
      cleanup = () => {
        stopped = true;
        reset();
        if (timer.current) clearInterval(timer.current);
        off.forEach((dispose) => dispose());
        detector?.close();
        detector = undefined;
        coachingStore.reset();
      };
      try {
        detector = await (options.loadDetector ?? loadDetector)();
      } catch {
        loadFailed = true;
        if (!stopped)
          coachingStore.set({
            status: 'error',
            error: 'Local object detector could not load. Check local model assets and reload.',
          });
        return;
      }
      if (stopped) {
        detector.close();
        detector = undefined;
        return;
      }
      coachingStore.set({ status: 'watching' });
      const tick = () => {
        if (
          stopped ||
          !detector ||
          ctx.video.paused ||
          ctx.video.ended ||
          ctx.video.readyState < 2 ||
          !ctx.video.videoWidth
        )
          return;
        const tripMs = ctx.clock.nowMs();
        if (lastTripMs === tripMs) return;
        lastTripMs = tripMs;
        detectorMs += CV_INTERVAL_MS;
        const began = performance.now();
        let scene: CvScene;
        let tracks: Track[];
        try {
          tracks = tracker.update(detector.detect(ctx.video, detectorMs));
          scene = builder.update(tracks, tripMs);
        } catch {
          coachingStore.set({
            ...coachingStore.get(),
            status: 'error',
            error: 'Local detection failed on this frame.',
          });
          return;
        }
        framesProcessed++;
        coachingStore.set({
          ...coachingStore.get(),
          cvScene: scene,
          cvTracks: tracks.filter((track) =>
            scene.objects.some((object) => object.id === track.id),
          ),
          cvFrames: framesProcessed,
          cvLatencyMs: performance.now() - began,
        });
        const key = sceneKey(scene);
        if (
          !scene.objects.length ||
          controller ||
          tripMs - lastRequestMs < ANALYSIS_INTERVAL_MS ||
          (key === lastSentKey && tripMs - lastRequestMs < SCENE_REFRESH_MS)
        )
          return;
        const mine = version;
        const abort = new AbortController();
        controller = abort;
        lastRequestMs = tripMs;
        lastSentKey = key;
        sceneMemory = sceneMemory.filter((entry) => tripMs - entry.tripMs <= SCENE_MEMORY_MS);
        previousScenes = previousScenes.filter((entry) => tripMs - entry.tripMs <= SCENE_MEMORY_MS);
        for (const [text, time] of recent) if (tripMs - time > 20000) recent.delete(text);
        const input: CoachingRequest = {
          scene,
          previousScenes: previousScenes.slice(-3),
          sceneMemory,
          recentAdvice: [...recent.keys()].slice(-3),
        };
        previousScenes = [...previousScenes, scene].slice(-3);
        const started = performance.now();
        coachingStore.set({ ...coachingStore.get(), status: 'analyzing', error: undefined });
        ctx.bus.emit('dataSent', {
          destination: 'anthropic-vision',
          tripMs,
          summary: `Local CV scene with ${scene.objects.length} tracked objects submitted to Claude; no images, GPS or audio.`,
        });
        void (options.analyze ?? analyze)(
          input,
          AbortSignal.any([abort.signal, AbortSignal.timeout(13000)]),
        )
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
                ...coachingStore.get(),
                status: 'watching',
                reason: 'Previous coaching arrived too late; monitoring the current scene.',
              });
              return;
            }
            const result = parseCoachingResponse(raw);
            if (!result) throw new Error('Coaching response was invalid.');
            sceneMemory = rememberScene(sceneMemory, result, tripMs);
            if (result.sceneChanged) {
              previousScenes = [];
              recent.clear();
            }
            coachingStore.set({
              ...coachingStore.get(),
              status: 'ready',
              message: result.shouldSpeak ? result.message : undefined,
              reason: result.reason,
              observations: result.observations,
              uncertainties: result.uncertainties,
              coachingPoint: result.coachingPoint,
              frameTripMs: tripMs,
              latencyMs: performance.now() - started,
            });
            if (!result.shouldSpeak) return;
            const normalized = adviceKey(result.message);
            if (
              [...recent].some(
                ([text, time]) => adviceKey(text) === normalized && now - time < 20000,
              )
            )
              return;
            recent.set(result.message, now);
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
                ...coachingStore.get(),
                status: 'error',
                error: error instanceof Error ? error.message : 'Coaching unavailable.',
              });
          })
          .finally(() => {
            if (controller === abort) controller = undefined;
          });
      };
      timer.current = setInterval(tick, CV_INTERVAL_MS);
    },
    stop() {
      cleanup?.();
      cleanup = undefined;
    },
  };
}
export const visionModule = createVisionModule();
