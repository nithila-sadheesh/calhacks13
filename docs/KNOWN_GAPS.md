# Current integration: local CV → Claude → Cartesia

All contributor branches remain merged on `integration`. Production now uses one local object-detection/tracking path and sends compact scene JSON to Claude for coaching. No new dependency, cloud CV service, OCR pipeline or agent framework was added.

## What runs

1. Video replay supplies the clock and frames. The existing local EfficientDet-Lite0 model is loaded/warmed before playback; it then processes video at a target 8 fps, with actual throughput depending on the laptop.
2. The IoU tracker and small scene builder describe repeatedly observed objects: class, tentative ID, detector score, image-side/zone, image motion, apparent-size trend, observed duration. Start threshold is 0.45, with at least two observations; these are initial settings, not evaluated accuracy guarantees.
3. Scene changes trigger image-free requests to Claude. Minimum three seconds between request starts, one request in flight, five-second refresh for unchanged nonempty scenes. Empty scenes do not force a call. A coarse signature ignores ID/confidence jitter and unknown-to-stable transitions.
4. Claude uses the existing instructor prompt and written examples but is explicitly restricted to supplied CV facts. It returns observations/uncertainties/teaching point plus speech or silence. The server strips unsupported input fields and forwards no GPS/image/audio fields in CV mode.
5. Existing arbiter/voice/captions/timeline handle validated coaching, repeat/mute, expiry and audio cancellation. Map is context-only by default (`?mapSpeech=1` enables supplementary speech).

The overlay shows local boxes and ongoing CV frame/count/latency updates while Claude is pending. Startup waits for the local model; **Enable replay sound** also warms Cartesia before replay. Setup and Data use now distinguish local video from the scene descriptions sent to Anthropic.

## Try it

- Set both provider keys server-side in git-ignored `.env`, then restart `npm run dev`.
- Open `/` without mocks, load drive, enable replay sound, and play. Look for local boxes/CV counts first; Claude may then speak or choose silence.
- Expand **What the coach observed** to inspect the model's interpretation and uncertainties.
- `?mock=voice` runs real CV and Claude without Cartesia speech. `?mock=vision` supplies scripted coaching for UI/audio testing. Mocks are not detection evidence.
- `frameRuntime.ts` preserves the previous frame-upload module for comparison tests only. The explicit opt-in image API diagnostic still sends images; it is not called by the default app.

## Supported observations and remaining limits

- Detectable classes: person, bicycle, car, truck, bus, motorcycle, stop sign, traffic light. Classification can be wrong, especially small distant road users. A person box does not distinguish an occupant from a pedestrian.
- Image displacement includes camera motion. A growing box is not a calibrated distance, approach speed, collision estimate or proof of danger. Track IDs can change or accidentally match across cuts. Do not call them verified vehicle identities.
- Stop/light detections do not establish all-way controls, who arrived/stopped first, signal colors, sign applicability or a safe maneuver. Four-way-stop reasoning, speed-limit recognition, lane/merge topology, indicator timing and metric proximity remain unsupported. They need additional measured perception/context; Claude must not invent them.
- The teaching library remains available, but much of its junction/visibility guidance needs facts a basic detector does not supply. Text-only mode is a latency/context tradeoff, not a guarantee of better instruction.
- Live text-only checks returned valid JSON in about 2.0–6.3 seconds. Claude selected silence when CV supplied only weak car/person tracks without supported road context. Those runs validate connectivity and uncertainty handling, not driving-instructor quality or consistently fast speech. Do not force a warning quota.
- The video is only 11.28 seconds; a later request or sentence can be canceled by trip end. Get a longer suitable recording and a separate holdout before evaluating continuous coaching.
- GPS/features remain placeholders; two annotation acceptance tests skip. No map/video sync or real 2–3 route-cue acceptance is claimed.
- Live physical speaker/mic behavior, no-overlap perception, deployment/HTTPS and instructor review still need human acceptance. Server rate limiting is warm-instance-only, not distributed authentication/quota protection.
- Prompt, low-effort Sonnet settings and static-guide caching are retained. They do not remove network/generation latency. Cached images are not used in default CV mode.
- Optional map fallback captions still retain full reminder text when shorter bundled clips play; unchanged from the earlier integration.

## Verification

Typecheck, lint, build and **272 unit/integration tests pass; 2 annotation checks skip**. Coverage includes scene-field validation, camera-relative motion, threshold/history handling, ID/confidence-insensitive scene signatures, one in-flight request, ongoing CV during network waits, silence, duplicate suppression, late startup disposal, seek reset, and both old image-mode and new CV-mode real arbiter/voice wiring with simulated audio/network.

The full browser regression suite passes **11 checks**, with **3 opt-in live checks skipped by default**. Chrome checks exercise real local model/video processing, image-free request bodies, coaching/evidence UI, replay controls, sound readiness and token retry. Opt-in live tests send scene JSON to Claude and can stream resulting text to Cartesia. A separate legacy detector diagnostic and legacy image-input API test remain explicitly named/opt-in; their results are not the active hybrid path.

## Main files

- CV runtime: `app/src/vision/index.ts`; detector: `detector.ts`; tracker: `tracker.ts`.
- Scene summary/signature: `app/src/vision/cvScene.ts`; wire validation: `shared/cvScene.ts` and `shared/coaching.ts`.
- Server request/prompt: `server/visionAdvice.ts`, `server/coachingPrompt.ts`.
- UI: `coachingStore.ts`, `VisionOverlay.tsx`; downstream: `app/src/arbiter/`, `app/src/voice/`.
- Guidance sources/evidence limits: `docs/COACHING_GUIDE.md`. Current architecture supersedes the older VLM-only/default-frame-upload descriptions in historical notes.
