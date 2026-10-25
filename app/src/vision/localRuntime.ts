// Tejas's vision module. Runs the MediaPipe detector on frames of the shared <video>, tracks
// boxes, and raises `webcamAlert` / `cameraHealth` from real detections only (never a timestamp:
// AGENTS.md rule 6). Publishes: webcamAlert, cameraHealth. Reads: video frames, clock, position
// (speed), tripReset. UI slot: VisionOverlay. See docs/DESIGN.md, "Tejas: vision and overlay".
import { log } from '../../../shared/log.ts';
import type { AppModule, ModuleContext } from '../../../shared/types.ts';
import { createAlertEngine } from './alerts.ts';
import {
  ENABLE_FOLLOWING_DISTANCE,
  FRAME_INTERVAL_MS,
  HEALTH_POLL_MS,
  STALL_MS,
} from './config.ts';
import { loadDetector, type VisionDetector } from './detector.ts';
import { bottomCenter, pointInForwardRegion } from './geometry.ts';
import { visionStore, type OverlayDetection } from './store.ts';
import { createTracker } from './tracker.ts';

export function createVisionModule(): AppModule {
  let runtime: ReturnType<typeof createRuntime> | undefined;
  return {
    name: 'vision',
    async start(ctx: ModuleContext) {
      runtime?.stop();
      const next = createRuntime(ctx);
      runtime = next;
      await next.start();
    },
    stop() {
      runtime?.stop();
      runtime = undefined;
    },
  };
}

export const visionModule = createVisionModule();

function createRuntime(ctx: ModuleContext) {
  const { bus, clock, video } = ctx;
  const tracker = createTracker();
  const alerts = createAlertEngine({ enableFollowingDistance: ENABLE_FOLLOWING_DISTANCE });

  let detector: VisionDetector | undefined;
  let rafId = 0;
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  let offReset: (() => void) | undefined;
  let offPosition: (() => void) | undefined;
  let stopped = false;

  let speedMps = 0;
  let lastVideoTime: number | undefined;
  // Monotonic timestamp for the detector only. Never reset (MediaPipe requires it to keep
  // increasing for the detector's whole life) and never used for trip or alert timing.
  let detectorTs = 0;
  let lastInferWall = performance.now();
  let healthOk = true;
  // The box behind the current alert, kept lit until the alert's trip-time expiry.
  let currentAlert: { trackId: number; reason: string; expiresMs: number } | undefined;

  function publishHealth(ok: boolean, reason?: string): void {
    if (ok === healthOk) return;
    healthOk = ok;
    bus.emit('cameraHealth', reason === undefined ? { ok } : { ok, reason });
    const snap = visionStore.get();
    visionStore.set({ ...snap, health: reason === undefined ? { ok } : { ok, reason } });
    log('vision', `camera health ${ok ? 'ok' : 'down'}`, reason);
  }

  function clearState(): void {
    speedMps = 0;
    lastVideoTime = undefined;
    tracker.reset();
    alerts.reset();
    currentAlert = undefined;
    visionStore.reset();
    // A reset means we are alive again; re-arm health without emitting a spurious transition.
    healthOk = detector !== undefined;
    if (!healthOk) {
      visionStore.set({
        ...visionStore.get(),
        health: { ok: false, reason: 'detector unavailable' },
      });
    }
    lastInferWall = performance.now();
  }

  function processFrame(): void {
    if (stopped || !detector) return;
    const playable = !video.paused && !video.ended && video.readyState >= 2 && video.videoWidth > 0;
    if (!playable) {
      // Paused or not ready: skip inference but keep the stall watchdog from firing.
      lastInferWall = performance.now();
      return;
    }

    // A stalled video must not count the same pedestrian frame four times.
    if (lastVideoTime === video.currentTime) return;
    lastVideoTime = video.currentTime;
    detectorTs += FRAME_INTERVAL_MS;
    let detections;
    try {
      detections = detector.detect(video, detectorTs);
    } catch (e: unknown) {
      log('vision', 'detectForVideo threw', e);
      return;
    }
    lastInferWall = performance.now();

    const tripMs = clock.nowMs();
    const tracks = tracker.update(detections);
    const result = alerts.update({ tracks, tripMs, speedMps });

    if (result) {
      currentAlert = {
        trackId: result.trackId,
        reason: result.alert.reason,
        expiresMs: result.alert.expiresMs,
      };
      bus.emit('webcamAlert', result.alert);
      log('vision', `alert ${result.alert.kind}`, result.alert.reason);
    } else if (currentAlert && tripMs > currentAlert.expiresMs) {
      currentAlert = undefined;
    }

    const overlay: OverlayDetection[] = tracks.map((t) => ({
      id: t.id,
      cls: t.cls,
      score: t.score,
      box: t.box,
      inRegion: pointInForwardRegion(bottomCenter(t.box)),
    }));
    visionStore.set({
      detections: overlay,
      alertTrackId: currentAlert?.trackId ?? null,
      alertReason: currentAlert?.reason ?? null,
      health: { ok: healthOk },
    });
  }

  function loop(): void {
    if (stopped) return;
    processFrame();
    // rAF paces us near the display rate; the detector throttles itself by wall time below.
    rafId = requestAnimationFrame(throttle);
  }

  // Keep inference near TARGET_FPS rather than the ~60 Hz of requestAnimationFrame.
  let lastLoopWall = 0;
  function throttle(): void {
    if (stopped) return;
    const now = performance.now();
    if (now - lastLoopWall >= FRAME_INTERVAL_MS) {
      lastLoopWall = now;
      loop();
    } else {
      rafId = requestAnimationFrame(throttle);
    }
  }

  function watchHealth(): void {
    if (stopped) return;
    const playing = !video.paused && !video.ended;
    if (video.readyState < 2 || video.videoWidth === 0) {
      if (playing) publishHealth(false, 'video unavailable');
      return;
    }
    if (playing && performance.now() - lastInferWall > STALL_MS) {
      publishHealth(false, 'inference stalled for over 2 s');
      return;
    }
    publishHealth(true);
  }

  async function start(): Promise<void> {
    offPosition = bus.on('position', (p) => {
      speedMps = p.speedMps;
    });
    offReset = clock.onReset(() => clearState());

    try {
      detector = await loadDetector();
    } catch (e: unknown) {
      if (stopped) return;
      log('vision', 'detector failed to load', e);
      publishHealth(false, 'detector unavailable');
      return;
    }
    if (stopped) {
      detector.close();
      detector = undefined;
      return;
    }

    log('vision', 'detector loaded');
    bus.emit('cameraHealth', { ok: true });
    lastInferWall = performance.now();
    lastLoopWall = 0;
    healthTimer = setInterval(watchHealth, HEALTH_POLL_MS);
    rafId = requestAnimationFrame(throttle);
  }

  function stop(): void {
    stopped = true;
    cancelAnimationFrame(rafId);
    if (healthTimer) clearInterval(healthTimer);
    offReset?.();
    offPosition?.();
    detector?.close();
    detector = undefined;
    visionStore.reset();
  }

  return { start, stop };
}
