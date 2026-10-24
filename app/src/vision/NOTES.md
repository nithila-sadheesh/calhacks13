# Vision module notes (Tejas)

Spike and implementation notes for `app/src/vision/`. See `docs/DESIGN.md`, "Tejas: vision and
overlay" for the plan, and `AGENTS.md` for the shared rules.

## What it does

Runs the MediaPipe Tasks Vision object detector (EfficientDet-Lite0) in video mode on frames of
the shared `<video>`, tracks boxes across frames, and raises a conservative `webcamAlert` only
from accumulated real detections. Also reports `cameraHealth`. Nothing is scripted from a
timestamp (AGENTS.md rule 6); alert timing comes only from `ctx.clock.nowMs()`.

## Files

| File | Role | Browser? |
| --- | --- | --- |
| `config.ts` | Every tunable number (thresholds, forward region, cooldowns, clip keys) | no |
| `geometry.ts` | Pure box math: IoU, bottom-center, forward-region test, smoothing | no |
| `tracker.ts` | IoU association + EMA smoothing + stable ids | no |
| `alerts.ts` | Alert state machine: pedestrian 4-of-5, following-distance, cooldown, expiry | no |
| `detector.ts` | MediaPipe loader + detection → normalized boxes | yes |
| `store.ts` | In-module pub/sub the frame loop writes and the overlay reads | no |
| `index.ts` | The `AppModule`: frame loop, wiring, health watchdog, reset | yes |
| `VisionOverlay.tsx` | Canvas overlay: boxes, region, alert highlight, reason, health badge | yes |
| `*.test.ts` | Vitest for every pure decision function | — |

Decision logic is pure and unit-tested (`geometry`, `tracker`, `alerts`); the browser files
(`detector`, `index`, `VisionOverlay`) are thin wiring around it.

## Model and wasm: vendored, offline, in-browser

- Detector: **EfficientDet-Lite0**, COCO labels, allow-listed to
  `person, bicycle, car, truck, bus, motorcycle`.
- The model file `assets/efficientdet_lite0.tflite` (float16, ~7 MB) is committed in this folder,
  downloaded once from
  `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`.
- The MediaPipe wasm runtime is the one in `node_modules/@mediapipe/tasks-vision@1.1.1/wasm`,
  imported through Vite with `?url` (`vision_wasm_internal.js` + `vision_wasm_internal.wasm`).
  `WasmFileset` is just `{ wasmLoaderPath, wasmBinaryPath }`, so we build it from those URLs
  instead of pointing `FilesetResolver.forVisionTasks()` at a CDN.
- **Net effect:** the detector loads from local assets with no network call, and video frames are
  processed entirely in the browser. This is what backs the privacy claim "Video: stays on this
  device" (AGENTS.md rule 9). The production build bundles the model and wasm as static assets.

If the wasm/model ever need to move out of the bundle (size), the clean option is to serve them
from the public dir — that needs Rohit (he owns `vite.config.ts` and the public dir). Not needed
now; the local-asset path works and keeps everything in Tejas's folder.

## Alert rules (from the design doc)

- **pedestrianNearby (primary):** a `person` at confidence ≥ 0.6 whose box bottom-center is inside
  the forward region, present in ≥ 4 of the last 5 processed frames. Text: "Pedestrian ahead.
  Stay alert." Never "crossing". `clipKey: 'pedestrian'`.
- **followingDistance (fallback, off by default):** a vehicle filling ≥ 35 % of the frame width
  inside the forward region for 2 s while speed > 5 m/s. Text: "Leave more space ahead."
  `clipKey: 'followingDistance'`. Turn on only if the pedestrian alert proves unreliable on our
  footage, by flipping `ENABLE_FOLLOWING_DISTANCE` in `config.ts`.
- **Debounce/expiry:** 8 s cooldown per kind; `expiresMs = detection trip time + 1.5 s`. Tracker,
  cooldowns and alert state all clear on `tripReset`.

## Forward region

Fixed lower-center trapezoid in normalized `[0,1]` frame coordinates (`FORWARD_REGION` in
`config.ts`): top edge y=0.55 spanning x 0.34–0.66, bottom edge y=1.0 spanning x 0.12–0.88.
Assumes a landscape mount, low and centered. Tune against the demo footage and record the final
numbers here.

## Camera health

A 500 ms watchdog. While the video is playing, if no successful inference lands for over 2 s
(`STALL_MS`), or the video is unavailable (`readyState < 2` / `videoWidth === 0`), it emits
`cameraHealth { ok: false }` and the overlay shows "Camera paused. Route reminders only." It emits
`{ ok: true }` again on recovery. Transitions are deduplicated so the bus sees one event per
change. Pausing the video is not a stall (the watchdog only counts time while playing).

## Clip keys — message for Nithila

`webcamAlert.clipKey` is `'pedestrian'` for the pedestrian alert and `'followingDistance'` for the
fallback. These must exist in `fixtures/audio/manifest.json`. `'pedestrian'` already matches the
vision mock. If Nithila's keys differ, change `CLIP_KEYS` in `config.ts` (one place) — do not
change the contract.

## Timestamps and the clock

- Alert `tripMs`/`expiresMs` use `ctx.clock.nowMs()` only.
- `detectForVideo` needs a strictly-increasing timestamp for the detector's lifetime; we use a
  private monotonic counter (`detectorTs`), never reset, never used for trip logic.
- `performance.now()` is used only to pace the frame loop near 8 fps and to measure the health
  stall — real-time measurement, not trip or cue timing. `Date.now()` is never used (lint-enforced).

## Verified so far

`npm run typecheck`, `npm run lint`, `npm test` (33 tests) and `npm run build` all pass. The build
bundles the model and wasm as local assets.

## Still needs a browser + the demo clip

Real detection cannot be hand-verified until `fixtures/demo-drive/video.mp4` exists (team
recording, committed by Rohit via Git LFS — see `docs/KNOWN_GAPS.md`). Must be H.264 (not HEVC)
and not HDR, landscape. Once it lands, run in Chrome on the demo laptop and confirm:

1. Boxes track people/vehicles; the forward-region trapezoid is drawn.
2. A pedestrian walking into the lower-center fires one `pedestrianNearby`; the overlay highlights
   that box in red and shows the reason.
3. Disabling the detector removes the alert (acceptance test "Frame-based alert").
4. Forcing inference to stall for 2 s shows "Camera paused" and emits `cameraHealth { ok: false }`.

Then fill in `HOLDOUT.md` from a second clip with no retuning.
