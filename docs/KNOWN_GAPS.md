# Known gaps and things to know

Current state: Rohit’s shell and Nithila’s voice implementation are combined on `integration`. Branch-level verification is recorded in the owner notes; combined checks and live Chrome acceptance must be rerun. Map and vision remain stubs.

## Missing pieces

| Gap | Owner | Notes |
| --- | --- | --- |
| Real drive video not recorded yet | whole team (records), Rohit (commits) | `fixtures/demo-drive/video.mp4` is a 60 s H.264 test pattern with an on-screen seconds counter, committed through Git LFS. It has no pedestrians or road features, so only mocks produce events on it. Replace it with the real drive at the end and re-run `npm run e2e` and `tests/e2e/smoke.md`. |
| Token endpoint dev routing differs | Rohit, Nithila | The implemented handler is `api/cartesia-token.ts`. Vite still loads the legacy `server/cartesia-token.ts` 501 stub. Align dev routing before testing streaming through `npm run dev`. Vercel deployment remains unverified. |
| Map and vision remain stubs | Jeev, Tejas | Voice and arbiter are implemented. Real route cues and frame-based alerts await their owners; use explicit map/vision mocks for integration testing. |
| Drive fixtures are placeholders | Jeev | Track, route and features are sample data. Six generated PCM clips and a populated audio manifest are supplied by Nithila. |
| Turn cues may not need a `Route` change | Jeev | `features.json` already supports `turnLeft`/`turnRight` with `street` and `routeDistM`. Confirm before asking for a `Route` contract change. |
| Clip key alignment pending | Rohit, Nithila, Tejas | Voice ships `pedestrianNearby`, `followingDistance`, `cameraPaused`, `turn`, `stopSign`, `crosswalk`. The vision mock uses `pedestrian`; arbiter fallback keys use `fallbackTurn`, `fallbackStopSign`, `fallbackCrosswalk`. Voice currently derives fallback keys from approved text and ignores `fallbackClipKey`. Align consumers before claiming integrated alert playback. |
| Voice behavior on mute and pause | Rohit, Nithila | Arbiter lets the current line finish on mute. Voice resets audio and cancels microphone capture on pause/end/reset, emitting speechEnded for active playback. Verify the combined resume behavior in Chrome. |
| Interrupted cues rarely get replayed | Jeev | The arbiter replays an interrupted cue once if it is still before `expiresMs` after the alert ends (about 2 s for the alert line, plus a 1 s gap). With the design's 3 s "drop after" windows, most interrupted cues expire first and the timeline shows "dropped: expired". If the demo should show a replay, cues need a longer `expiresMs`. |
| No Spanish, stretch or live-camera work | team | Chosen at Checkpoint 2. |

## Arbiter behaviour other modules rely on

Rules: `app/src/arbiter/rules.ts`, one test per rule in `rules.test.ts`.

- **Speak ids are unique per spoken line**, `${sourceId}#${n}`, and never repeat across seeks. A replayed or repeated cue gets a new id. `speechStarted` and `speechEnded` must echo the `speak` id.
- **One line at a time.** The next line starts only after `speechEnded` for the current id. If none arrives within the estimated length (14 characters/s) plus 4 s of trip time, the arbiter assumes the line ended and logs it. Voice must still always emit `speechEnded`.
- **Priority 0 interrupts by itself.** The arbiter emits the alert's `speak` at once and logs the old line as `interrupted`. Voice cuts the audio and emits `speechEnded { interrupted: true }` for the old id; the arbiter ignores that late event.
- **Spacing:** a fresh cue starts at least 4 s after the last line ended. Replays and repeats wait 1 s. Alerts never wait.
- **Repeat** re-speaks the last spoken route cue (never an alert), even while muted, because the user asked.
- **Camera down** speaks the camera-paused clip once per trip.

## Design limits of the scaffold

- **Reset is driven by `seeked`.** Any seek, including the video restarting after it ends, emits `tripReset`. Your module must clear its state on it. Do not assume it fires once.
- **Panels mount before modules start.** `Drive.tsx` renders every panel first, then starts the modules, then publishes the current `tripState` (`idle` at the start). Panels see events emitted inside `start()`.
- **The `useEvents` hook keeps events since the last `tripReset`.** It is meant for small panels. Do not use it for high-rate events such as `position` at 10 Hz. It grows without limit.
- **The video is muted** in `Drive.tsx` so dashcam audio does not overlap Cartesia. Change this only with Rohit.
- **Playback is locked to 1x** and the speed menu is hidden. The judged run is real time only.
- **The debug log skips `position`** so the console stays readable. Every other event is logged, in the order it was emitted.
- **Mocks are scripted on purpose.** The map and vision mocks fire at fixed times (3 s and 5 s). Real modules must never do this (AGENTS.md rule 6).

## Tooling notes

- **Versions are new.** npm resolved React 19, TypeScript 6, ESLint 10, Vite 8 and Vitest 5. Decided: stay on React 19 (AGENTS.md updated).
- **End-to-end tests** (`npm run e2e`) use Playwright with installed Chrome (`channel: 'chrome'`), because Playwright's bundled Chromium cannot play H.264. They start their own dev server on port 5174.
- **Git LFS** is required to get the video: run `git lfs install` once per machine before cloning or pulling.
- **Node 22.6 or newer** is required. `npm run route`, `track` and `clips` run `.ts` scripts through Node's built-in type stripping, so scripts cannot use `enum`, `namespace` or parameter properties, and imports need explicit `.ts` extensions. `erasableSyntaxOnly` in `tsconfig.json` catches this.
- **ESLint enforces AGENTS.md rules.** Importing another module's folder from `app/src/{map,vision,voice,arbiter}`, using `Date.now()`, and using bare `console.*` are errors. Only `shared/log.ts`, `scripts/`, `server/` and `tests/` may print. Do not weaken the rules to get past an error; fix the code, or ask Rohit.
- **Line endings are LF** (`.gitattributes`). Run `npm run format` before committing. Prettier ignores `*.md`, `docs/` and `fixtures/`.
- **`fixtures/` is Vite's public directory.** Files are served at `/demo-drive/...` and `/audio/...`, not `/fixtures/...`. `publicDir` copies the whole folder into `dist`, including the video.
- **`annotations.json` is never loaded by the app.** `loadFixtures()` skips it on purpose. Tests may read it from disk.
- **Dependencies:** `@mediapipe/tasks-vision` (Tejas) and `@playwright/test` (dev, Rohit). Anything else needs Rohit's approval, since he edits `package.json` and the lockfile.

## Contract changes

The "contract" is the set of shared definitions all four modules build against: `shared/types.ts` (every event and its payload, the fixture formats, `AppModule` and `ModuleContext`), `shared/bus.ts`, and `shared/mocks/`. It is frozen so that four people working in parallel cannot drift apart. If one module adds a field the others do not know about, they stop fitting together, and nobody finds out until integration.

Only Rohit edits these files, and only with team approval. If you need a change, write a short request (file, change, reason) and send it to Rohit. Do not work around the contract with a cast, an extra field or a side channel.

Changes made on `rohit/shell` (all additive; nothing existing changed meaning):

| Change | Why | Who is affected |
| --- | --- | --- |
| `SpeakRequest.fallbackClipKey?: string` | The arbiter knows the cue's feature kind; voice does not. Voice plays this clip if streaming fails or is slow, instead of parsing the text. | Nithila: read it in the network fallback. |
| `ArbiterDecision.speakId?: string` (on `spoken` and `interrupted`) | Exact join of a decision to its `speechStarted` latency, even when a cue is spoken twice. | Nobody else publishes it. |
| `bus.onAny` listeners run before per-type listeners | The debug log now shows an event before any events its listeners emit, so the log reads in cause-and-effect order. | No module uses `onAny` for logic. |
| Mock arbiter sets `speakId` | Matches the real arbiter. | Nobody. |
