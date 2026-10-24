# Vision: local CV and Claude coaching

Default production flow: local EfficientDet-Lite0 → IoU tracking → compact scene JSON → Claude teaching prompt → `visionAdvice` → arbiter → Sonic. Frames stay local; object descriptions and textual context go to Anthropic.

- `index.ts`: target 8 fps, one detector runtime, lifecycle cleanup; event-driven model requests with a three-second minimum and five-second unchanged-scene refresh, one request in flight.
- `detector.ts`: existing local model/WASM, GPU with creation-time CPU fallback, local downscaling and blank-canvas warmup before playback. Warmup creates no road observation.
- `tracker.ts`: tentative IoU IDs. `cvScene.ts`: repeated observations at score >=0.45, coarse image geometry/motion; no calibrated distance, speed, parking state, lanes or arrival order.
- `shared/cvScene.ts` / `shared/coaching.ts`: bounded, validated CV JSON and model results; scene and image payloads cannot be mixed.
- `coachingStore.ts` / `VisionOverlay.tsx`: live local boxes/counts/latency plus coaching/evidence. CV keeps updating while Claude waits.
- `server/visionAdvice.ts` / `coachingPrompt.ts`: text-only requests by default, explicit unknowns, authored instructor scenarios and conservative response validation.

`frameRuntime.ts` preserves the previous image-upload implementation for comparison/regression tests. `localRuntime.ts` preserves the original fixed-warning implementation. Neither is imported by the production entry point. The shared detector/tracker remain reused, not duplicated as simultaneously active pipelines.

Only basic object classes are supplied: person, bicycle, car, truck, bus, motorcycle, stop sign, traffic light. Signs/lights have no OCR/color/applicability interpretation. Image motion may be ego motion; growing boxes are not physical proximity. Track IDs and model memory cannot prove who arrived first. The prompt must not fill these gaps with handbook knowledge.

See `docs/KNOWN_GAPS.md` for measured latency, current short-video limits and test status; `docs/COACHING_GUIDE.md` for the teaching library and uncertainty requirements. Holdout/instructor review remains pending.
