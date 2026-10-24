// Pure alert state machine (docs/DESIGN.md tasks 4-6). Given the tracks present each processed
// frame plus the trip clock and current speed, it decides when to raise a conservative
// `webcamAlert`. Every alert here comes from accumulated real detections, never a timestamp
// (AGENTS.md rule 6). No browser, no wall clock: fully unit-testable.
import type { WebcamAlert } from '../../../shared/types.ts';
import {
  ALERT_TTL_MS,
  COOLDOWN_MS,
  CLIP_KEYS,
  ENABLE_FOLLOWING_DISTANCE,
  FOLLOW_MIN_SPEED_MPS,
  FOLLOW_MIN_WIDTH_FRAC,
  FOLLOW_SUSTAIN_MS,
  PED_FRAMES_REQUIRED,
  PED_FRAMES_WINDOW,
  PED_MIN_CONF,
  VEHICLE_CLASSES,
} from './config.ts';
import { bottomCenter, pointInForwardRegion } from './geometry.ts';
import type { Track } from './tracker.ts';

const inForwardRegion = (track: Track): boolean => pointInForwardRegion(bottomCenter(track.box));

export type AlertKind = WebcamAlert['kind'];

export type AlertInput = {
  tracks: Track[];
  tripMs: number;
  speedMps: number;
};

// The alert plus the id of the track that caused it, so the overlay can highlight that box.
export type AlertResult = { alert: WebcamAlert; trackId: number };

export type AlertConfig = { enableFollowingDistance: boolean };

export type AlertEngine = {
  update(input: AlertInput): AlertResult | null;
  reset(): void;
};

export function createAlertEngine(
  config: AlertConfig = { enableFollowingDistance: ENABLE_FOLLOWING_DISTANCE },
): AlertEngine {
  // Per-track ring of the last PED_FRAMES_WINDOW "qualified as a forward pedestrian" booleans.
  const pedHistory = new Map<number, boolean[]>();
  // Per-track trip time when a vehicle first began continuously qualifying as too-close.
  const followSince = new Map<number, number>();
  const lastFired = new Map<AlertKind, number>();
  let seq = 0;

  function onCooldown(kind: AlertKind, tripMs: number): boolean {
    const last = lastFired.get(kind);
    return last !== undefined && tripMs - last < COOLDOWN_MS;
  }

  function makeAlert(
    kind: AlertKind,
    text: string,
    reason: string,
    confidence: number,
    tripMs: number,
  ): WebcamAlert {
    seq += 1;
    return {
      id: `${kind}-${seq}`,
      kind,
      text,
      reason,
      confidence,
      tripMs,
      expiresMs: tripMs + ALERT_TTL_MS,
      clipKey: CLIP_KEYS[kind],
    };
  }

  function evaluatePedestrian({ tracks, tripMs }: AlertInput): AlertResult | null {
    const present = new Map<number, Track>();
    const qualifies = new Set<number>();
    for (const track of tracks) {
      if (track.cls !== 'person') continue;
      present.set(track.id, track);
      if (track.score >= PED_MIN_CONF && inForwardRegion(track)) qualifies.add(track.id);
    }

    // Advance every known history, recording absence as a non-qualifying frame.
    const ids = new Set<number>([...pedHistory.keys(), ...present.keys()]);
    for (const id of ids) {
      const hist = pedHistory.get(id) ?? [];
      hist.push(qualifies.has(id));
      if (hist.length > PED_FRAMES_WINDOW) hist.shift();
      // Drop a full window of misses so the map cannot grow without bound.
      if (hist.length === PED_FRAMES_WINDOW && hist.every((q) => !q)) pedHistory.delete(id);
      else pedHistory.set(id, hist);
    }

    if (onCooldown('pedestrianNearby', tripMs)) return null;

    // Among tracks present this frame that have met 4-of-5, pick the most confident.
    let best: { track: Track; trues: number } | undefined;
    for (const [id, track] of present) {
      const hist = pedHistory.get(id);
      if (!hist || hist.length < PED_FRAMES_WINDOW) continue;
      const trues = hist.filter(Boolean).length;
      if (trues < PED_FRAMES_REQUIRED) continue;
      if (!best || track.score > best.track.score) best = { track, trues };
    }
    if (!best) return null;

    lastFired.set('pedestrianNearby', tripMs);
    const reason = `person, conf ${best.track.score.toFixed(2)}, ${best.trues} of ${PED_FRAMES_WINDOW} frames, forward region`;
    const alert = makeAlert(
      'pedestrianNearby',
      'Pedestrian ahead. Stay alert.',
      reason,
      best.track.score,
      tripMs,
    );
    return { alert, trackId: best.track.id };
  }

  function evaluateFollowing({ tracks, tripMs, speedMps }: AlertInput): AlertResult | null {
    const present = new Map<number, Track>();
    const qualifies = new Set<number>();
    const movingFastEnough = speedMps > FOLLOW_MIN_SPEED_MPS;
    for (const track of tracks) {
      if (!VEHICLE_CLASSES.includes(track.cls)) continue;
      present.set(track.id, track);
      if (movingFastEnough && track.box.w >= FOLLOW_MIN_WIDTH_FRAC && inForwardRegion(track)) {
        qualifies.add(track.id);
      }
    }

    // Start or clear the sustain timer per track; only continuous qualification counts.
    for (const id of [...followSince.keys()]) {
      if (!qualifies.has(id)) followSince.delete(id);
    }
    for (const id of qualifies) {
      if (!followSince.has(id)) followSince.set(id, tripMs);
    }

    if (onCooldown('followingDistance', tripMs)) return null;

    for (const id of qualifies) {
      const since = followSince.get(id);
      const track = present.get(id);
      if (since === undefined || !track) continue;
      const heldMs = tripMs - since;
      if (heldMs < FOLLOW_SUSTAIN_MS) continue;
      lastFired.set('followingDistance', tripMs);
      const reason = `${track.cls}, width ${Math.round(track.box.w * 100)}% of frame, held ${(heldMs / 1000).toFixed(1)}s, speed ${speedMps.toFixed(1)} m/s`;
      const alert = makeAlert(
        'followingDistance',
        'Leave more space ahead.',
        reason,
        track.score,
        tripMs,
      );
      return { alert, trackId: track.id };
    }
    return null;
  }

  function update(input: AlertInput): AlertResult | null {
    // Pedestrian is evaluated first (and always, to keep its history current), so it preempts.
    const ped = evaluatePedestrian(input);
    if (config.enableFollowingDistance) {
      const follow = evaluateFollowing(input);
      return ped ?? follow;
    }
    return ped;
  }

  function reset(): void {
    pedHistory.clear();
    followSince.clear();
    lastFired.clear();
    seq = 0;
  }

  return { update, reset };
}
