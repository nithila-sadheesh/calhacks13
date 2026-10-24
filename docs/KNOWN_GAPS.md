# Integration status and handoff

Current branch: `integration`. Rohit’s replay/arbiter/shell, Nithila’s voice/API/audio, and Jeev’s map/route tooling are merged. Tejas’s vision module is also merged. All four implementations are connected; real-footage detection and full-demo acceptance remain unverified.

## Requirements against the design

| Requirement | Status | Evidence or remaining work |
| --- | --- | --- |
| Replay master clock, 1x lock, seek reset | Implemented; footage acceptance pending | Unit coverage; recorded video restored; full real-drive acceptance still needs matching GPS |
| Arbiter priority, interruption, expiry, dedupe, spacing, mute/repeat | Implemented | Rule tests and real map/arbiter/voice integration test with simulated audio/transport |
| GPS interpolation, route progress, cue generation and Upcoming panel | Implemented; real-drive acceptance pending | Map tests pass; current track/features remain placeholders |
| Sonic streaming, local cancellation, fallback, bundled warnings | Implemented; live acceptance pending | Voice tests and combined pipeline coverage; six generated PCM files shipped |
| Ink push-to-talk, command matching, privacy events | Implemented; live recognition pending | Simulated capture/transport tests; Chrome mic and noisy-room acceptance still required |
| Captions, timeline, data-use panel, supervisor check | Implemented; full replay acceptance pending | Reducer tests and Chrome setup check |
| Module startup and browser sound readiness | Implemented | Playback controls wait for modules and sound enable; Chrome readiness test passes |
| Token endpoint and local routing | Implemented; deployed acceptance pending | Dev and production use `api/cartesia-token.ts`; Chrome cross-origin rejection test passes |
| Frame processing, alerts, camera health and overlay | Implemented; real-footage acceptance pending | Local model/WASM load in Chrome; lifecycle tests cover frozen frames and recovery |
| Track/video sync and 2–3 real route cues | Blocked by missing validated drive fixtures | Empty annotations cause two acceptance checks to skip |
| Full real-drive demo and holdout report | Pending validated fixtures and recorded evidence | All module code merged; no full real-drive acceptance claim |

## Remaining blockers

- **Video asset restored:** Git LFS is installed and configured locally; the incoming 30,459,712-byte MP4 has been downloaded. Refresh the browser if it previously received the pointer. `ffprobe` identifies H.264, 3840×2160, yuv420p/BT.709, duration 11.28 seconds. It plays in Chrome, but is too short for the planned two-minute demo. Matching GPS, annotation alignment, and pedestrian suitability remain unverified; downloaded media alone does not establish those acceptance criteria.
- **Jeev’s fixtures:** committed track has two points spanning 10 seconds; features contain one explicitly labelled placeholder stop sign. Obtain the matching GPX and run the existing track/route scripts. Verify curated changes, add two landmark annotations and expected cues using `app/src/map/NOTES.md`, then run the acceptance tests. Runtime never loads annotations. Do not invent coordinates or sync evidence.
- **Vision acceptance:** frame processing, tracking, alerts, health and overlay are implemented. Verify pedestrian detection on the actual demo clip, show that disabling inference removes the alerts, tune only on the primary clip, then run a separate holdout without retuning and fill `app/src/vision/HOLDOUT.md`. Its empty result fields are not evidence of zero misses or false alerts.
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

## How to inspect the current app

1. Run `npm ci` if dependencies are absent, then `npm run dev`. Open Vite’s printed local URL.
2. `/` selects all four real modules. `/?mock=vision` selects real map/arbiter/voice with a scripted alert. `/?mock=map,vision` selects scripted route/alert inputs with real arbiter/voice. `/?mock=map,vision,voice` tests the shell without Cartesia or audio. Mocks are test inputs, never detection evidence.
3. Check the supervisor box, load the drive, and wait for startup. With real voice click **Enable replay sound**, then use the video controls. The actual LFS media is now present locally for replay. The current GPS/features are placeholders and do not establish alignment with the incoming video.
4. Without playable video, `/app/src/voice/runtime.html` exercises the production voice engine, bundled clips, interruption and push-to-talk independently of replay. Enable sound there. Sonic/Ink need `CARTESIA_API_KEY` configured server-side; preloaded bundled clips do not. The older `spike.html` is an early experiment, not the integrated app.
5. Inspect captions, Upcoming, the overlay, timeline and data-use panel. Repeat/mute commands belong to the arbiter; the standalone voice test page does not prove the full arbiter interaction.
6. Once video/GPS are validated, run the full browser suite and `tests/e2e/smoke.md`, exercise all four real modules without `?mock=`, and rehearse before a merge to main.

## Integration fixes after vision merge

- Vision now uses the shipped `pedestrianNearby` clip key, so detector-derived alerts can play the bundled warning through real arbiter/voice.
- Frames are downscaled locally to at most 640 pixels wide; bounding boxes are normalized against the resized frame. The local model/WASM load is checked in Chrome with no external asset requests.
- A frozen video timestamp is processed once rather than accumulating repeated-frame alert evidence. The watchdog reports a stall and detects recovery when frames resume.
- Repeated vision starts dispose the old runtime; stopping during model loading closes the late detector. Reset clears cached speed/frame identity and preserves unavailable-detector status.
- No shared contract changes, dependencies, synthetic runtime cues or network inference were introduced.

## Verification

Typecheck, lint and production build pass. Unit/integration suite: **239 passed, 2 skipped**. The skipped tests need real landmark and expected-cue annotations. Combined tests exercise mock and real map, plus a real vision runtime/tracker/alert engine with simulated detector output, through real arbiter/voice. Audio/network are simulated; cases include offline fallback, interruption, repeat, pause and seek reset. Synthetic route fixtures exist only in tests.

Four Chrome checks pass: supervisor setup, implemented local token routing, delayed voice-loading/sound-unlock gating, and actual local vision model/WASM initialization. All eight Chrome tests now pass, including cue/alert mock replay, seek reset, pause and 1x lock with the restored video. Browser sound-context unlocking does not prove audible speaker output or microphone recognition, and mock replay does not prove real pedestrian detection.

## Existing contract additions retained

Rohit’s branch adds optional `SpeakRequest.fallbackClipKey`, optional `ArbiterDecision.speakId`, and cause-first `onAny` listener ordering. Integration adds no new shared fields or dependencies. Further shared contract changes require team approval.
