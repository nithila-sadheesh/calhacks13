import { log } from '../../../shared/log.ts';
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
import { fallbackAdvice } from './fallbackAdvice.ts';
import { rememberScene } from './sceneMemory.ts';
import { coachingStore, type CoachingDiagnostic } from './coachingStore.ts';

export const CV_INTERVAL_MS = 125;
export const ANALYSIS_INTERVAL_MS = 3000;
export const SCENE_REFRESH_MS = 5000;
export const MAX_RESPONSE_AGE_MS = 8000;
export const ADVICE_TTL_MS = 10000;
// Local reminders only fill real silences, and the gap varies so they never sound like a timer.
export const QUIET_GAPS_MS = [12000, 16000, 20000];
// A local reminder is not repeated word for word within this window.
export const REMINDER_REPEAT_MS = 45000;
// Claude's own lines need this much quiet after the previous line finished.
export const CLAUDE_MIN_GAP_MS = 5000;

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
    periodicReminders?: boolean;
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
      let playing = ctx.source === 'live' ? false : !ctx.video.paused;
      let version = 0;
      let detectorMs = 0;
      let lastTripMs: number | undefined;
      let lastRequestMs = -Infinity;
      let lastSentKey: string | undefined;
      let controller: AbortController | undefined;
      let sceneMemory: SceneMemory[] = [];
      let previousScenes: CvScene[] = [];
      const recent = new Map<string, number>();
      const reminders = new Map<string, number>();
      let framesProcessed = 0;
      let requestSequence = 0;
      let lastAdviceMs: number | undefined;
      let speakingId: string | undefined;
      // When the voice last started or finished any line; undefined until something is spoken.
      let lastLineMs: number | undefined;
      let fallbackTurn = 0;
      const diagnostic = (id: number, changes: Partial<CoachingDiagnostic>) => {
        const current = coachingStore.get();
        coachingStore.set({
          ...current,
          diagnostics: current.diagnostics?.map((entry) =>
            entry.id === id ? { ...entry, ...changes } : entry,
          ),
        });
      };
      coachingStore.set({ status: 'loadingCv' });
      const reset = () => {
        version++;
        const pending =
          coachingStore.get().diagnostics?.filter((entry) => entry.outcome === 'Pending') ?? [];
        for (const entry of pending)
          diagnostic(entry.id, { outcome: 'Cancelled: playback paused, ended or reset' });
        controller?.abort();
        controller = undefined;
        tracker.reset();
        builder.reset();
        sceneMemory = [];
        previousScenes = [];
        recent.clear();
        reminders.clear();
        lastTripMs = undefined;
        lastRequestMs = -Infinity;
        lastSentKey = undefined;
        framesProcessed = 0;
        lastAdviceMs = undefined;
        speakingId = undefined;
        lastLineMs = undefined;
        fallbackTurn = 0;
        if (!stopped)
          coachingStore.set({
            status: detector ? 'watching' : loadFailed ? 'error' : 'loadingCv',
            error: loadFailed
              ? 'Local object detector is unavailable. Reload to retry.'
              : undefined,
            cvScene: undefined,
            diagnostics: coachingStore.get().diagnostics,
          });
      };
      const off = [
        ctx.bus.on('speak', ({ id }) => {
          speakingId = id;
          lastAdviceMs = lastLineMs = ctx.clock.nowMs();
        }),
        ctx.bus.on('speechEnded', ({ id }) => {
          if (speakingId !== id) return;
          speakingId = undefined;
          // Gaps count from when the voice stopped, not from when the line was queued.
          lastAdviceMs = lastLineMs = ctx.clock.nowMs();
        }),
        ctx.bus.on('tripReset', () => {
          reset();
          coachingStore.set({ ...coachingStore.get(), diagnostics: [] });
        }),
        ctx.bus.on('tripState', ({ state }) => {
          playing = state === 'playing';
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
      log('vision', 'detector loaded');
      coachingStore.set({ status: 'watching' });
      const tick = () => {
        if (
          stopped ||
          !playing ||
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
        ctx.bus.emit('visionScene', scene);
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
        if (lastAdviceMs === undefined) lastAdviceMs = tripMs;
        // A pending Claude request may produce a better line, so the local reminder waits for it.
        if (
          options.periodicReminders !== false &&
          !speakingId &&
          !controller &&
          tripMs - lastAdviceMs >= QUIET_GAPS_MS[fallbackTurn % QUIET_GAPS_MS.length]!
        ) {
          const reminder = fallbackAdvice(scene, fallbackTurn);
          const said = reminders.get(reminder.text);
          if (said === undefined || tripMs - said >= REMINDER_REPEAT_MS) {
            fallbackTurn++;
            lastAdviceMs = tripMs;
            reminders.set(reminder.text, tripMs);
            ctx.bus.emit('visionAdvice', {
              id: `vision-fallback-${++sequence}`,
              text: reminder.text,
              reason: 'Local observation reminder after a quiet stretch; no new Claude coaching.',
              tripMs,
              expiresMs: tripMs + 3000,
              delivery: reminder.delivery,
            });
          }
        }
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
          quietForMs: speakingId ? 0 : Math.max(0, tripMs - (lastLineMs ?? 0)),
        };
        previousScenes = [...previousScenes, scene].slice(-3);
        const started = performance.now();
        const requestId = ++requestSequence;
        coachingStore.set({
          ...coachingStore.get(),
          status: 'analyzing',
          error: undefined,
          diagnostics: [
            ...(coachingStore.get().diagnostics ?? []),
            {
              id: requestId,
              tripMs,
              objects: scene.objects,
              outcome: 'Pending',
            },
          ].slice(-30),
        });
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
            const result = parseCoachingResponse(raw);
            diagnostic(requestId, {
              latencyMs: performance.now() - started,
              ...(result ? { response: result } : {}),
              outcome: 'Discarded: playback paused, ended or reset',
            });
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
              diagnostic(requestId, { outcome: 'Discarded: response older than 8 seconds' });
              coachingStore.set({
                ...coachingStore.get(),
                status: 'watching',
                reason: 'Previous coaching arrived too late; monitoring the current scene.',
              });
              return;
            }
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
            if (!result.shouldSpeak) {
              diagnostic(requestId, { outcome: 'Claude chose silence' });
              return;
            }
            const normalized = adviceKey(result.message);
            if (
              [...recent].some(
                ([text, time]) => adviceKey(text) === normalized && now - time < 20000,
              )
            ) {
              diagnostic(requestId, { outcome: 'Suppressed: duplicate recommendation' });
              return;
            }
            if (speakingId || (lastLineMs !== undefined && now - lastLineMs < CLAUDE_MIN_GAP_MS)) {
              diagnostic(requestId, { outcome: 'Suppressed: too soon after the previous line' });
              return;
            }
            diagnostic(requestId, { outcome: 'Sent to arbiter (not confirmation of audio)' });
            lastAdviceMs = now;
            recent.set(result.message, now);
            ctx.bus.emit('visionAdvice', {
              id: `vision-advice-${++sequence}`,
              text: result.message,
              reason: result.reason,
              tripMs,
              expiresMs: tripMs + ADVICE_TTL_MS,
              ...(result.delivery ? { delivery: result.delivery } : {}),
            });
          })
          .catch((error: unknown) => {
            diagnostic(requestId, {
              latencyMs: performance.now() - started,
              outcome: abort.signal.aborted
                ? 'Cancelled: playback paused, ended or reset'
                : error instanceof Error
                  ? error.message
                  : 'Coaching request failed',
            });
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
