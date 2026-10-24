# VLM integration status

Current branch: `integration`. All four contributors’ code is merged. The user approved a new architecture: Claude interprets sampled video frames and generates coaching; Cartesia speaks the validated text. The old object detector is retained for legacy diagnostics, not the default app.

## Working implementation

- Video frames → `/api/vision-advice` → Claude → validated `visionAdvice` → arbiter → Sonic. Default model: `claude-sonnet-5-5`; optional server override `ANTHROPIC_MODEL`.
- Map still publishes positions/cues and fills Upcoming. Map speech is off by default; append `?mapSpeech=1` to enable supplementary advisory reminders. No GPS is sent to Claude.
- Vision samples once per second, keeps at most three resized JPEGs, starts after two, and starts at most one request every three seconds. Only one request is in flight. Pause/seek/reset/end/disposal abort analysis and discard obsolete results.
- Results older than eight seconds are ignored; advice expires ten seconds after the newest analyzed frame. Exact repeated messages are suppressed for 20 seconds; recent suggestions also go into the prompt. New video advice replaces queued older video/map reminders. Ordinary model coaching waits for current speech to finish and respects mute; it never assigns emergency priority.
- Server holds the prompt, key, model, schema and timeouts. POST bodies are bounded to 800 KB; each of 2–3 JPEGs is at most 240 KB base64. Explicit cross-origin requests are rejected. Warm-instance rate limit is 30/minute, not distributed access control.
- Voice accepts generated text only with the vision origin marker and shared validation. Map wording and bundled clips retain their existing validation. No invented offline fallback for arbitrary coaching: failed streaming ends the line.
- Replay waits for module startup and explicit **Enable replay sound**. Captions/timeline follow spoken coaching; overlay shows analysis state, observation, suggestion and response time. Setup/data-use UI discloses Anthropic frame uploads and Cartesia use.
- Keys remain server-only. Image payloads are never logged or committed. Recorded video stays local except for sampled frames submitted to Anthropic. GPS is not sent; visual locations may be recognizable.

## Run it

1. Set `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` in git-ignored `.env`. Optional `ANTHROPIC_MODEL` defaults to Sonnet 5.5. Restart `npm run dev` after changing server environment variables.
2. Open the root URL without mocks, check the supervisor box, load the drive, click **Enable replay sound**, then play. Expect analysis to take several seconds; silence is permitted when there is nothing useful to add.
3. Watch the video-coach status and timeline. Upload metadata appears under Data use; no raw frames are listed. Repeat/mute/unmute use the existing push-to-talk controls.
4. `?mock=vision` supplies scripted VLM-style advice without Anthropic requests. `?mock=voice` tests video/arbiter/UI without Cartesia audio. Mocks are always test inputs, never evidence of real analysis.
5. The standalone `/app/src/voice/runtime.html` remains an audio-only diagnostic, not proof of the video-to-coaching flow.

## Verification and current limits

- Typecheck, lint and build pass; **254 unit/integration tests pass, 2 annotation checks skip**. The full Chrome suite passes **10 tests**, with the live API test skipped by default; that live check was also run separately and passed. Both configured keys were verified absent from the client build. Tests cover bounded/invalid requests, structured response validation, model errors/refusals, cancellation, duplicate/stale advice, queue/voice origin handling, repeat, real arbiter/voice transport wiring and replay controls.
- A live opt-in check sent three real recorded frames to Anthropic. HTTP 200, valid coaching JSON, approximately **4.4 seconds** end-to-end API latency on that one request. It suggested scanning crosswalks and curb edges. The prompt was subsequently tightened to request shorter messages. This result does not establish robust latency or accurate scene understanding.
- `npm run e2e` normally uses a mocked model endpoint for deterministic coaching coverage. `LIVE_VLM_CHECK=1 npm run e2e -- tests/e2e/coaching.spec.ts --grep 'live Claude'` performs one explicit real-model check; it sends frames and consumes credits. Legacy detector diagnostics are separate and do not describe production behavior.
- The downloaded video is H.264, 3840×2160, yuv420p/BT.709, **11.28 seconds**. It is too short for the planned two-minute demo. Analysis plus speech can run beyond the remaining footage; trip end intentionally cancels old output. Obtain a longer suitable recording rather than stretching/replaying timestamps to simulate analysis.
- Track/features remain placeholders (two GPS points, one labelled curated stop). Two annotation acceptance tests remain skipped. Matching GPX and real annotated landmarks are needed before claiming map/video sync; map speech is therefore optional by default.
- Live Sonic audio, audible overlap/latency, Ink recognition and full rehearsal still need demo-laptop verification. Simulated transport tests do not prove speaker output.
- Prompt/text filters are conservative guardrails, not a guarantee of correct or timely driving advice. No lane-clearance/right-of-way/light-color/speed-limit or emergency-action claims are allowed. A recording/holdout review with model errors and omissions remains required.
- Exact duplicate detection does not catch every paraphrase. Tune cadence, message length, freshness windows and prompt from measured replay behavior; do not force a message for every request.
- Vercel deployment remains unverified. Configure both server keys, deploy API functions with the app, and check real HTTPS requests. Function timeout for analysis is 20 seconds; upstream timeout 12 seconds. Do not expose keys with `VITE_` prefixes.
- Optional map fallback captions still retain the full request when a shorter bundled route clip plays. Exact fallback-caption reporting needs a separate contract decision; this does not affect generated video text.

## Files to change next

- Prompt/model request: `server/visionAdvice.ts`; endpoint: `api/vision-advice.ts`.
- Cadence, freshness, cancellation: `app/src/vision/index.ts`; frame size/quality: `capture.ts`.
- Wire validation/text constraints: `shared/coaching.ts`; event contracts: `shared/types.ts`.
- Priority and queue policy: `app/src/arbiter/`; audio: `app/src/voice/`.
- Legacy detector: `app/src/vision/localRuntime.ts`, `detector.ts`, tracker/alerts/config and associated tests. Production does not load the local model/WASM assets.
