# Integration status and handoff

Current branch: `integration`. Rohit’s replay/arbiter/shell, Nithila’s voice/API/audio, and Jeev’s map/route tooling are merged. Tejas’s vision module remains a stub. No real frame-based detection is claimed.

## Requirements against the design

| Requirement | Status | Evidence or remaining work |
| --- | --- | --- |
| Replay master clock, 1x lock, seek reset | Implemented; footage acceptance pending | Unit coverage; full browser replay needs the LFS video |
| Arbiter priority, interruption, expiry, dedupe, spacing, mute/repeat | Implemented | Rule tests and real map/arbiter/voice integration test with simulated audio/transport |
| GPS interpolation, route progress, cue generation and Upcoming panel | Implemented; real-drive acceptance pending | Map tests pass; current track/features remain placeholders |
| Sonic streaming, local cancellation, fallback, bundled warnings | Implemented; live acceptance pending | Voice tests and combined pipeline coverage; six generated PCM files shipped |
| Ink push-to-talk, command matching, privacy events | Implemented; live recognition pending | Simulated capture/transport tests; Chrome mic and noisy-room acceptance still required |
| Captions, timeline, data-use panel, supervisor check | Implemented; full replay acceptance pending | Reducer tests and Chrome setup check |
| Module startup and browser sound readiness | Implemented | Playback controls wait for modules and sound enable; Chrome readiness test passes |
| Token endpoint and local routing | Implemented; deployed acceptance pending | Dev and production use `api/cartesia-token.ts`; Chrome cross-origin rejection test passes |
| Real frame-based alerts, camera health and overlay | Pending Tejas | Keep vision mocked explicitly until his branch is ready |
| Track/video sync and 2–3 real route cues | Blocked by missing validated drive fixtures | Empty annotations cause two acceptance checks to skip |
| Full real-drive demo and holdout report | Pending all modules and recorded evidence | No full end-to-end acceptance claim |

## Remaining blockers

- **Video asset:** Jeev’s merge replaced the old test-pattern pointer with a different LFS pointer (30,459,712 bytes). Its contents, codec and alignment have not been verified. This checkout has only the pointer and no Git LFS executable. On the demo machine install Git LFS, run `git lfs pull --include=fixtures/demo-drive/video.mp4`, then inspect/play the actual asset. Do not substitute generated footage to pass replay tests.
- **Jeev’s fixtures:** committed track has two points spanning 10 seconds; features contain one explicitly labelled placeholder stop sign. Obtain the matching GPX and run the existing track/route scripts. Verify curated changes, add two landmark annotations and expected cues using `app/src/map/NOTES.md`, then run the acceptance tests. Runtime never loads annotations. Do not invent coordinates or sync evidence.
- **Tejas:** deliver real frame processing, tracking, alert debounce/expiry, camera health, overlay and holdout report. Use the existing shared video and clock, clear on reset, and publish only `webcamAlert`/`cameraHealth`. No inference or footage uploads.
- **Live media/deployment:** verify Sonic, local interruption, Ink repeat/mute/unmute, offline clips, measured latency and pause/seek on the demo laptop in Chrome. Follow Nithila’s `app/src/voice/DEPLOYMENT.md` for Vercel and server-side key setup. No deployed endpoint or live microphone success is asserted here.
- **Fallback captions:** the shared request carries the full route reminder while network fallback plays its approved shorter clip. Captions currently retain request text per the design contract. Exact fallback-caption synchronization needs an agreed voice-status contract before changing shared fields.

## Module connection rules

- Real map → `position`/`mapCue`; arbiter → `speak`/`arbiterDecision`; voice → `speechStarted`/`speechEnded`/`voiceCommand`/`dataSent`. Speech lifecycle events echo the unique `speak.id`.
- Shipped clip keys: `pedestrianNearby`, `followingDistance`, `cameraPaused`, `turn`, `stopSign`, `crosswalk`. Tejas must use `pedestrianNearby`, not `pedestrian`.
- Arbiter supplies `fallbackClipKey` for route cues. Voice accepts it only if it matches the approved fallback for the sentence; requests without it retain text-based fallback for compatibility. Traffic lights have no bundled fallback.
- Dev Vite loads the same `api/cartesia-token.ts` entry point as Vercel, with server environment variables. `api/` is included in typechecking. Keys stay out of client assets and logs.
- Panels subscribe before modules start. Playback remains unavailable until startup completes; with real voice, click **Enable replay sound** before video controls appear. Voice mock mode renders no real mic/audio controls.
- Trip time comes from the video clock only. Map clears through `clock.onReset`; arbiter and voice clear on `tripReset`. Voice also cancels playback/capture on pause and end.
- Arbiter lets a line finish on mute, suppresses later route cues, and still permits warnings and explicit repeat. Verify this behavior live.
- An interrupted route cue is replayed once only while valid. Short map expiry windows can legitimately result in an expired drop after a warning; do not extend them merely to force a demo replay.
- `useEvents` retains events since reset; do not use it for high-rate position history. UpcomingPanel uses the map-owned snapshot store.
- Fixtures are served at `/demo-drive/...` and `/audio/...`. All map queries run in offline preparation scripts, never during replay.

## How to integrate vision next

1. Compare Tejas’s branch against its merge base, especially shared-file edits and clip keys; preserve the integrated contracts.
2. Merge on `integration`, resolve conflicts by behavior, and retain the module/panel entry points. Do not introduce cross-module imports.
3. Start with `?mock=vision` (real map, arbiter and voice). Use `?mock=map,vision` only for the explicitly scripted test flow while real fixtures are unavailable. Mock cues and alerts are not detection evidence.
4. Remove the vision mock once its owner’s checks pass. Verify actual detections drive alerts, camera stalls announce once, and seek clears tracker/cooldowns and all downstream state.
5. Run required checks and `tests/e2e/smoke.md`, then rehearse the full 1x real-drive script before any merge to main.

## Verification

Typecheck, lint and production build pass. Unit/integration suite: **206 passed, 2 skipped**. The skipped tests need real landmark and expected-cue annotations. Combined tests exercise both mock and real map with real arbiter/voice, simulated audio/network, offline fallback, interruption, repeat, pause and seek reset. Synthetic route fixtures exist only in tests.

Three Chrome checks pass: supervisor setup, implemented local token routing, and delayed voice-loading/sound-unlock gating. Four full replay checks remain blocked by the LFS pointer instead of playable video; rerun `npm run e2e` after restoring the asset. Browser sound-context unlocking does not prove audible speaker output or microphone recognition.

## Existing contract additions retained

Rohit’s branch adds optional `SpeakRequest.fallbackClipKey`, optional `ArbiterDecision.speakId`, and cause-first `onAny` listener ordering. Integration adds no new shared fields or dependencies. Further shared contract changes require team approval.
