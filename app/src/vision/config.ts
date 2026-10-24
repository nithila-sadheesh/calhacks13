// Every tunable number for the vision module lives here, so tuning on the demo clip is one file.
// See docs/DESIGN.md, "Tejas: vision and overlay". None of this is scripted trip timing; alert
// timing still comes only from ctx.clock.nowMs() (AGENTS.md rule 5).

// COCO classes we keep (detector allowlist). EfficientDet-Lite0 uses COCO label names.
export const DETECTOR_CLASSES = ['person', 'bicycle', 'car', 'truck', 'bus', 'motorcycle'] as const;
export type DetectorClass = (typeof DETECTOR_CLASSES)[number];
export const VEHICLE_CLASSES: readonly DetectorClass[] = ['car', 'truck', 'bus', 'motorcycle'];

// Frame loop. Downscale wide and aim for 5-10 inferences/second; skip frames, never queue.
export const INFERENCE_WIDTH = 640;
export const TARGET_FPS = 8;
export const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

// Detector. A low score floor lets the tracker see weak boxes; the alert rules apply the real
// 0.6 pedestrian threshold on top.
export const SCORE_THRESHOLD = 0.4;
export const MAX_RESULTS = 10;

// Primary alert: pedestrianNearby. A person at >= 0.6 confidence, inside the forward region,
// seen in at least 4 of the last 5 processed frames.
export const PED_MIN_CONF = 0.6;
export const PED_FRAMES_WINDOW = 5;
export const PED_FRAMES_REQUIRED = 4;

// Fallback alert: followingDistance. Off until the pedestrian alert proves unreliable on our
// footage (docs/DESIGN.md task 5). A vehicle filling the forward region for 2 s while moving.
export const ENABLE_FOLLOWING_DISTANCE = false;
export const FOLLOW_MIN_WIDTH_FRAC = 0.35;
export const FOLLOW_SUSTAIN_MS = 2000;
export const FOLLOW_MIN_SPEED_MPS = 5;

// Debounce and expiry (docs/DESIGN.md task 6).
export const COOLDOWN_MS = 8000;
export const ALERT_TTL_MS = 1500;

// Camera health (docs/DESIGN.md task 7): no inference for this long while playing is a stall.
export const STALL_MS = 2000;
export const HEALTH_POLL_MS = 500;

// Tracker (docs/DESIGN.md task 3): match boxes by overlap, smooth position and size.
export const TRACK_IOU_MATCH = 0.3;
export const TRACK_SMOOTHING = 0.5; // EMA weight on the new box; higher reacts faster
export const TRACK_MAX_MISSES = 5; // drop a track after this many frames unmatched

// Forward region: a fixed lower-center trapezoid in normalized [0,1] frame coordinates. Assumes a
// landscape mount, low and centered (docs/DESIGN.md "iPhone footage notes").
export const FORWARD_REGION = {
  topY: 0.55,
  topLeftX: 0.34,
  topRightX: 0.66,
  bottomY: 1,
  bottomLeftX: 0.12,
  bottomRightX: 0.88,
} as const;
export type ForwardRegion = typeof FORWARD_REGION;

// Bundled-clip keys for each alert kind. Must match fixtures/audio/manifest.json (Nithila's
// manifest keys). If those keys differ, this is the one place to change.
export const CLIP_KEYS: Record<'pedestrianNearby' | 'followingDistance', string> = {
  pedestrianNearby: 'pedestrian',
  followingDistance: 'followingDistance',
};
