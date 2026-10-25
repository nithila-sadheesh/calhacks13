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

### Coaching sensitivity and perception update

The coaching policy now permits specific preparatory cues from repeated detections without requiring a visible conflict. Duplicate advice remains suppressed. Signs/signals enter scene summaries at 0.40 confidence after repeated observations; other classes retain 0.45. Added COCO dog, cat and train labels, and increased detector candidates to 20 (scene payload still capped at 10). This is broader coverage, not a measured accuracy improvement.

Every fourth inference adds one alternating left/right crop covering half the image width and the upper three quarters. Only sign/signal detections from crops are retained, mapped back to full-frame coordinates and deduplicated by same-class IoU. Crop calls use strictly increasing private model timestamps and preserve aspect ratio. This costs an extra inference on one quarter of frames. No additional model or dependency is downloaded.

Scene objects optionally carry normalized imageBox x/y/w/h through the validated server contract. These support image-relative comparisons, not physical distance, road placement, collision prediction or signal interpretation. Existing callers without boxes remain compatible. Claude is prompted for one practical 8–12-word sentence with matching CV-only examples. Prompt targets are not a guarantee of recommendation quality; test against labeled road footage before drawing accuracy conclusions. Small signs, sign applicability, camera cuts and object identities remain limitations. Sonic streaming requests use speed guidance 1.15; bundled fallback audio is unchanged.

### Request diagnostics

The overlay includes an expandable Coaching request diagnostics panel. It retains up to 30 local records containing submitted object snapshots, validated model responses, latency and disposition (silence, duplicate suppression, sent to arbiter, stale, cancelled or error). Records survive pause/end and clear on tripReset or module stop. No additional network requests are made. Cancelled requests may have no model response because the existing lifecycle aborts them. A sent-to-arbiter disposition does not prove audio played. Invalid responses are recorded as validation errors; raw invalid provider output is not displayed.

### Periodic replay reminders

Production replay now offers a local fallback about every three seconds without new advice, provided no speech request is active. A current stable object supplies a short image-side attention cue; with no stable objects the fallback asks the learner to observe/scan. This runs even while Claude is pending or silent, without extra model calls. The arbiter still controls actual playback, spacing and mute, so three seconds is a target rather than a speech-start guarantee. Reminders are explicitly labeled periodic local reminders in the timeline, not Claude outputs. Forward-camera person detections are called people, not assumed pedestrians. Road geometry is unknown: no instruction to continue straight is inferred. `periodicReminders: false` is available for isolated module tests.
