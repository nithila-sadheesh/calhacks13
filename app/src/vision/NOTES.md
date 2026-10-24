# Vision: Claude coaching runtime

The default module is now a VLM frame sampler, replacing the earlier MediaPipe decision path by explicit user approval. Current plan: `docs/DESIGN.md`, approved VLM revision.

- `index.ts`: samples recent frames, one request in flight, deduplication, stale response rejection and bus wiring.
- `capture.ts`: JPEG capture at up to 960 px wide, quality 0.65.
- `coachingStore.ts` / `VisionOverlay.tsx`: status, observation, latest suggestion and analysis latency.
- `shared/coaching.ts`: frame/response validation and normalized duplicate keys.
- `server/visionAdvice.ts`: prompt, model choice, JSON schema and Anthropic request; `api/vision-advice.ts` is the public server entry point.

Production publishes `visionAdvice` and Anthropic `dataSent` metadata. The arbiter publishes speech, and voice streams it through Sonic. Generated suggestions are ordinary coaching, not priority-zero emergency alerts. Model output never controls the vehicle or audio directly.

Frames are sent to Anthropic; GPS and mic audio are not. Both provider keys stay server-side. No image payload logging. Cancel/reset on pause, seek, trip reset, end and shutdown. One analyzed batch can yield silence.

The old detector implementation is retained as `localRuntime.ts` with detector/tracker/alerts/geometry/config and regression tests. It is not imported by the production entry point. `tests/e2e/videoInference.spec.ts` is a legacy local-detector diagnostic; it does not test VLM coaching. Old HOLDOUT.md records the former detector protocol and has no completed observations.

One live Claude request using actual footage returned valid coaching JSON in about 4.4 seconds. Further replay/holdout review and live speaker/microphone acceptance remain pending. Use longer footage: the current recording is only 11.28 seconds, so analysis plus speech may extend beyond its end.
