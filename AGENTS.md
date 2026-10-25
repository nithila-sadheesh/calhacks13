# AGENTS.md

Shared rules for every coding agent (Claude Code, Codex, or other) working in this repo. Four people work in parallel, each with their own agent. These rules exist so the four agents never fight over the same files or drift from the shared contracts.

Full plan: `docs/DESIGN.md` (exported from the team design doc). Read the section for your owner before starting a task.

## 1. Project in one paragraph

Learner Co-Pilot is a browser app (React, Vite, TypeScript) for supervised practice driving. A recorded iPhone dashcam video plays alongside its GPS track. While it plays, the map module emits route reminders, the vision module detects pedestrians in real video frames, the arbiter decides what is spoken and when, and the voice module speaks through Cartesia Sonic and listens through Cartesia Ink (push-to-talk). The demo must be honest: every alert comes from real processing during replay, never from scripted timestamps.

## 2. Who owns what

Before your first edit, confirm which person you are working for. If you don't know, ask.

| Owner | Feature | Owns (may edit) |
| --- | --- | --- |
| Jeev | Route, map cues, drive fixtures | `app/src/map/`, `scripts/route/`, `scripts/track/`, `fixtures/demo-drive/route.json`, `features.json`, `track.json`, `annotations.json` |
| Tejas | Vision and overlay | `app/src/vision/` |
| Nithila | Cartesia voice, server, deploy | `app/src/voice/`, `server/`, `api/`, `scripts/voice/`, `fixtures/audio/`, `vercel.json` |
| Rohit | Replay clock, arbiter, app shell, integration | `shared/`, `app/src/replay/`, `app/src/arbiter/`, `app/src/ui/`, `app/src/main.tsx`, `package.json`, lockfile, root config files, `tests/e2e/`, `.gitignore`, `.env.example` |

Shared by nobody: `fixtures/demo-drive/video.mp4` (team recording; Rohit commits it via Git LFS), `docs/` (edit only when your human asks).

## 3. Hard rules

1. **Edit only your owner's paths.** If the task needs a change outside them, stop. Write a short request (file, change, reason) for your human to send to the owner.
2. **Contracts are frozen.** Do not edit `shared/types.ts`, `shared/bus.ts` or `shared/mocks/` unless you work for Rohit and the team approved the change. If a contract blocks you, stop and propose the change with a reason.
3. **No cross-module imports.** A module may import only from `shared/`, its own folder, and approved npm packages. Modules talk only through bus events.
4. **One publisher per event.** Emit only the events your owner publishes (table in section 5). Subscribe to anything.
5. **One clock.** Trip time comes only from `ctx.clock.nowMs()`. Never use `Date.now()` for trip logic. `performance.now()` is allowed only for measuring latency. Every module clears its state on `tripReset`.
6. **No scripted behavior.** Runtime code must never read `annotations.json` or hardcode trip times for cues or alerts. `annotations.json` is for tests only.
7. **Safe wording only.** Spoken and displayed text comes only from the approved phrases in section 8. Never write text that tells the driver to brake, says a lane or intersection is clear, decides right-of-way, states a traffic-light color, estimates collision timing, or asserts a speed limit.
8. **No LLM in the driving path.** No model calls decide or word anything during replay or driving.
9. **Privacy.** Never send video frames, images or location to any network service. Only reminder text goes to Sonic; mic audio goes to Ink only while push-to-talk is held. Every Cartesia request emits a `dataSent` event.
10. **Secrets.** The Cartesia API key lives only in server environment variables and a git-ignored `.env`. Never put it in client code, logs, fixtures, tests or commits. The browser uses short-lived tokens from `/api/cartesia-token`.
11. **No new dependencies without approval.** Ask your human to get Rohit's OK; Rohit edits `package.json`.
12. **Keep the build green.** Before saying a task is done, run `npm run typecheck`, `npm run lint` and `npm test`, and report the results.

## 4. Stack and commands

- Node 22.6+, npm. Vite + React 19 + TypeScript (strict). Vitest for unit tests, Playwright (installed Chrome) for end-to-end tests. ESLint + Prettier with repo defaults.
- `npm run dev`: local dev server. Camera and mic need HTTPS on phones; use the Vercel preview URL or a tunnel for phone testing.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`.
- `/api/<name>` in dev runs the `GET` (etc.) handler exported from `api/<name>.ts`, with `.env` loaded. The same entry point serves token requests locally and on Vercel.
- Mocks: add `?mock=map,vision,voice,arbiter` (any subset) to the dev URL to replace those modules with their mocks.
- Vision: MediaPipe Tasks Vision object detector (EfficientDet-Lite0). Voice: Cartesia Sonic (TTS WebSocket) and Ink-2 (STT). Map data: OSRM and Overpass, fetched by scripts into fixtures; the app never calls them at runtime.

## 5. Module contract summary

Source of truth: `shared/types.ts`. Summary:

Each module exports an `AppModule` with `start(ctx)` and `stop()`. `ctx` provides `bus`, `clock`, `video` (read-only; only Rohit's replay code controls playback) and parsed `fixtures`.

| Event | Only publisher |
| --- | --- |
| `position`, `mapCue` | Jeev (map) |
| `webcamAlert`, `cameraHealth` | Tejas (vision) |
| `speechStarted`, `speechEnded`, `voiceCommand`, `dataSent` | Nithila (voice) |
| `speak`, `arbiterDecision`, `tripState`, `tripReset` | Rohit (arbiter, replay) |

UI slots: Rohit's layout mounts `VisionOverlay` (Tejas), `UpcomingPanel` (Jeev) and `VoicePanel` (Nithila). Owners change their own component; Rohit changes only the layout around it.

## 6. Code style

- TypeScript strict. No `any`; use `unknown` and narrow. Named exports only.
- Put decision logic in small pure functions (cue timing, arbiter rules, alert debounce, audio queue state) so it is unit-testable without a browser.
- React function components and hooks. No global state outside the bus.
- Comments only where the reason is not obvious from the code. No commented-out code, no emojis.
- Log through `shared/log.ts` (`log(module, message, data?)`), not bare `console.log`.
- Files: `camelCase.ts` for logic, `PascalCase.tsx` for components, tests beside the code as `name.test.ts`.

## 7. Testing

- Unit-test every pure decision function in your folder with Vitest.
- Test against mocks first, then real modules.
- Media behavior (camera, mic, audio playback) must also be checked by hand on the demo laptop in Chrome; say so when you report done.
- Acceptance tests and their owners are in `docs/DESIGN.md`, section "Acceptance tests".

## 8. Approved phrases

Use these exactly (English). Adding or changing a phrase needs the whole team's OK.

Route reminders (Jeev's templates, streamed by Sonic):
- `Left turn ahead onto {street}. Check for pedestrians before turning.`
- `Right turn ahead onto {street}. Check your mirror and blind spot.`
- `Stop sign ahead. Prepare for a complete stop.`
- `Crosswalk ahead. Scan both sides.`
- `Traffic light ahead. Be ready to stop.`

Bundled clips (Nithila, generated with Sonic and shipped in `fixtures/audio/`):
- `Pedestrian ahead. Stay alert.`
- `Leave more space ahead.`
- `Camera paused. Route reminders only.`
- `Turn ahead.` / `Stop sign ahead.` / `Crosswalk ahead.` (network fallbacks)

Assistant fixed lines (`server/assistant.ts`, `app/src/assistant/`):
- `That's for your supervisor to judge.` (Claude's refusal for the safety rules)
- `I can only answer driving-related questions.` (Claude's reply to off-topic requests)
- `That's for your supervisor to judge. Keep your eyes on the road.` (replaces any generated line the safety filter blocks)
- `Sorry, I can't answer that right now.` (the request failed or Claude declined)
- `Sorry, I didn't catch that. Could you say it again?` (Claude, when a transcript is too fragmentary to guess)
- `Nothing to repeat yet.` (the arbiter, when "repeat" has no earlier line to replay)

Claude's answers and its route-reminder wording are generated, so they are not listed here. Every generated line must pass `shared/safeWording.ts` before it can be spoken or shown.

## 9. Git workflow

- One branch per person: `rohit/<topic>`, `nithila/<topic>`, `tejas/<topic>`, `jeev/<topic>`.
- Commit messages start with the module: `map: time stop-sign cue by arrival`.
- Rebase on `main` before merging. Merge to `main` only at team checkpoints or when Rohit's smoke checklist (`tests/e2e/smoke.md`) passes.
- Never force-push `main`. Never commit `.env`, keys, tokens, or large media outside Git LFS.

## 10. When something is wrong outside your folder

- Another module misbehaves: write a minimal repro (steps, expected, actual, event log excerpt) for your human to send to its owner. Do not patch it.
- A contract seems wrong: stop and propose the change with the reason. Do not work around it with extra fields, casts, or side channels.
- Unsure whether something breaks a rule here: ask before doing it.

## 11. Definition of done for any task

- The change stays inside your owner's paths.
- Typecheck, lint and tests pass; results are reported.
- New decision logic has unit tests.
- No rule in section 3 is broken.
- A one-paragraph summary: what changed, how it was tested, anything the team must know (for example, a new event field you are requesting).
