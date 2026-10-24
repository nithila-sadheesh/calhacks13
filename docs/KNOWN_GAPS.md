# Known gaps and things to know

State of the scaffold at the first commit. `typecheck`, `lint`, `test` and `build` pass. Nothing has been checked by hand in a browser yet. Read this before starting your module.

## Missing pieces

| Gap | Owner | Notes |
| --- | --- | --- |
| `fixtures/demo-drive/video.mp4` does not exist | Rohit (commits), whole team (records) | Until it is added, the drive screen shows no video, so the clock never advances and no module sees time pass. `?mock=` runs need it too. |
| Git LFS is not set up | Rohit | `.gitattributes` has the rule for `video.mp4`, but `git lfs install` has not been run. Do it before the first video commit, or the file goes into normal history. |
| Token endpoint is not reachable on Vercel | Nithila | The existing `server/cartesia-token.ts` is a stub that returns 501. The agreed implementation path is `api/cartesia-token.ts`, with `api/` owned by Nithila. Moving and implementing the stub is still pending; this planning update does not move code. `vercel.json` only sets the build and output directory. |
| No local dev route for `/api/cartesia-token` | Nithila | `npm run dev` is plain Vite and does not serve Vercel functions in `api/`. Coordinate any required changes to Rohit-owned dev configuration with Rohit when the endpoint is implemented. |
| Real modules are stubs | each owner | `map`, `vision`, `voice` and `arbiter` only log on start. With no `?mock=`, nothing is emitted, so nothing is spoken. |
| Fixtures are placeholders | Jeev | `track.json`, `features.json` and `route.json` hold a 10-second straight line and one made-up stop sign (`source: 'curated'`). `annotations.json` and `fixtures/audio/manifest.json` are empty. |
| `Route` type is minimal | Jeev | `shared/types.ts` has `Route = { coordinates: [lon, lat][] }`. The design doc does not define the `route.json` format. If you need steps or street names, ask Rohit for a contract change. |
| No Spanish, stretch or live-camera work | team | Chosen at Checkpoint 2. |
| `tests/e2e/` has only the smoke checklist | Rohit | No automated end-to-end tests yet. |
| Dev-server run not checked in a browser | everyone | The dev server serves the page and fixtures, but nobody has opened `?mock=map,vision,voice,arbiter` and seen the UI work. Do this first. |

## Design limits of the scaffold

- **Panels miss events emitted before they mount.** `Drive.tsx` mounts `VisionOverlay`, `UpcomingPanel` and `VoicePanel` only after every module's `start()` has finished. An event emitted inside `start()` (for example the vision mock's `cameraHealth`) is missed by those three panels. `Captions`, `Timeline` and `DataUsePanel` mount earlier and do see it. If a panel needs early state, keep it in your module and read it from there.
- **`tripState` never reports `idle`.** The replay code emits `playing`, `paused` and `ended` only. Do not rely on `idle`.
- **Reset is driven by `seeked`.** Any seek, including the video restarting after it ends, emits `tripReset`. Your module must clear its state on it. Do not assume it fires once.
- **The `useEvents` hook keeps events since the last `tripReset`.** It is meant for small panels. Do not use it for high-rate events such as `position` at 10 Hz. It grows without limit.
- **The video is muted** in `Drive.tsx` so dashcam audio does not overlap Cartesia. Change this only with Rohit.
- **Timeline latency join is approximate.** It matches a `speak` request to its `speechStarted` by `sourceId` and then `id`. If the arbiter ever re-speaks the same source, the first match wins.
- **Mocks are scripted on purpose.** The map and vision mocks fire at fixed times (3 s and 5 s). Real modules must never do this (AGENTS.md rule 6).

## Tooling notes

- **Versions are new.** npm resolved React 19, TypeScript 6, ESLint 10, Vite 8 and Vitest 5. AGENTS.md says React 18. Tell Rohit if you hit an incompatibility or want 18.
- **Node 22.6 or newer** is required. `npm run route`, `track` and `clips` run `.ts` scripts through Node's built-in type stripping, so scripts cannot use `enum`, `namespace` or parameter properties, and imports need explicit `.ts` extensions. `erasableSyntaxOnly` in `tsconfig.json` catches this.
- **ESLint enforces AGENTS.md rules.** Importing another module's folder from `app/src/{map,vision,voice,arbiter}`, using `Date.now()`, and using bare `console.*` are errors. The current ESLint config allows printing in `shared/log.ts`, `scripts/`, legacy `server/` and `tests/`. The planned backend folder is now `api/`; coordinate any required ESLint config update with Rohit during migration. Do not weaken the rules to get past an error; fix the code, or ask Rohit.
- **Line endings are LF** (`.gitattributes`). Run `npm run format` before committing. Prettier ignores `*.md`, `docs/` and `fixtures/`.
- **`fixtures/` is Vite's public directory.** Files are served at `/demo-drive/...` and `/audio/...`, not `/fixtures/...`. `publicDir` copies the whole folder into `dist`, including the video.
- **`annotations.json` is never loaded by the app.** `loadFixtures()` skips it on purpose. Tests may read it from disk.
- **Dependencies:** `@mediapipe/tasks-vision` is installed for Tejas. Anything else needs Rohit's approval, since he edits `package.json` and the lockfile.

## Contract changes

The "contract" is the set of shared definitions all four modules build against: `shared/types.ts` (every event and its payload, the fixture formats, `AppModule` and `ModuleContext`), `shared/bus.ts`, and `shared/mocks/`. It is frozen so that four people working in parallel cannot drift apart. If one module adds a field the others do not know about, they stop fitting together, and nobody finds out until integration.

Only Rohit edits these files, and only with team approval. A contract change is any edit to them. Examples:

- Nithila needs `speechStarted` to carry an extra field.
- Jeev needs `route.json` to include turn-by-turn steps, which means changing the `Route` type. This is the most likely one, because the design doc never defined that file's format.
- Anyone needs a new npm dependency (Rohit owns `package.json`).

If you need one, write a short request (file, change, reason) and send it to Rohit. Do not work around the contract with a cast, an extra field or a side channel.

No changes have been requested yet.
