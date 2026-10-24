# Rohit: implementation plan

Working plan for Rohit's slice (replay clock, arbiter, app shell, integration). Source of truth for requirements is `docs/DESIGN.md`, section "Rohit"; this file says how we build it. Phases are in order; each ends green (`typecheck`, `lint`, `test`).

**Status (branch `rohit/shell`):** phases 0-3 and 5 are done for everything that does not depend on another owner. Phase 4 decisions were made and recorded in `docs/KNOWN_GAPS.md`. Remaining: swapping in real modules as they land (phase 5) and the demo (phase 6).

## Phase 0: unblock the environment

1. `brew install git-lfs ffmpeg`, then `git lfs install` (once per machine).
2. Branch `rohit/shell` off `main`.
3. Placeholder video: 60 s, 1280x720, 30 fps, H.264 (`yuv420p`, `+faststart`). The `testsrc` pattern shows a running seconds counter, so the clock can be checked by eye (Homebrew's ffmpeg has no `drawtext`). Commit it as `fixtures/demo-drive/video.mp4` through LFS (`git lfs ls-files` must list it). The real drive replaces it at the end.
   ```sh
   ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30:duration=60 \
     -c:v libx264 -pix_fmt yuv420p -profile:v high -movflags +faststart -an fixtures/demo-drive/video.mp4
   ```
4. Open `npm run dev` in Chrome with `?mock=map,vision,voice,arbiter`. Walk through setup, play, pause, seek and end. Write down every visual or console problem before changing code.

## Phase 1: replay clock and drive shell

**`app/src/replay/replay.ts`**
- Keep `tripMs = video.currentTime * 1000` as the only time source.
- Emit `tripState { idle }` once on creation, so the contract's `idle` is real.
- Lock playback to 1x: on `ratechange`, set `playbackRate` back to 1.
- Keep `seeked` → onReset callbacks, then `tripReset`. Any seek (including restart after `ended`) is a reset.
- Unit test `replay.test.ts` with a fake video built on Node's `EventTarget` (settable `currentTime`, `ended`, `playbackRate`): play/pause/ended mapping, pause-at-end is not reported as `paused`, seek fires callbacks before the bus event, `dispose` removes everything.

**`app/src/ui/Drive.tsx`**
- Two-phase start so panels never miss startup events: effect 1 loads fixtures and builds `ctx` (no module start); render mounts all panels; effect 2, keyed on `ctx`, starts the modules. Child effects run before parent effects, so every panel has subscribed before any `start()` runs.
- Show a clear message on `<video>` `error` (missing or unplayable file) instead of a blank stage.
- Remove the matching "Panels miss events" item from KNOWN_GAPS.md once this lands.

**`app/src/main.tsx`**
- Debug log: skip `position` (10 Hz) so the console stays readable.

## Phase 2: arbiter

Split into a pure core and a thin bus wrapper.

**`app/src/arbiter/rules.ts`** (pure, no bus, no clock)

```ts
type Item = {
  sourceId: string;          // MapCue.id / WebcamAlert.id / 'camera-paused'
  dedupeKey: string;         // featureId for cues, alert id for alerts
  origin: 'cue' | 'alert' | 'repeat' | 'system';
  alertKind?: WebcamAlert['kind'];
  text: string;
  clipKey?: string;
  priority: 0 | 1 | 2;
  earliestMs: number;
  expiresMs: number;
  replayed: boolean;         // interrupted once already
};

type ArbiterState = {
  queue: Item[];
  current?: { item: Item; speakId: string; startedMs: number };
  spokenKeys: ReadonlySet<string>;
  lastAlertMs: Partial<Record<WebcamAlert['kind'], number>>;
  lastCue?: Item;            // for repeat
  lastEndMs?: number;        // for spacing
  muted: boolean;
  cameraPausedSaid: boolean;
  playing: boolean;
  seq: number;               // for unique speak ids
};

type Input =
  | { type: 'cue'; cue: MapCue }
  | { type: 'alert'; alert: WebcamAlert }
  | { type: 'speechEnded'; id: string; interrupted: boolean }
  | { type: 'voice'; kind: 'repeat' | 'mute' | 'unmute' }
  | { type: 'camera'; ok: boolean }
  | { type: 'tripState'; state: 'idle' | 'playing' | 'paused' | 'ended' }
  | { type: 'tick' }
  | { type: 'reset' };

type Effect = { type: 'speak'; req: SpeakRequest } | { type: 'decision'; d: ArbiterDecision };

export function step(s: ArbiterState, input: Input, nowMs: number): { state: ArbiterState; effects: Effect[] };
```

`step` applies the input, then always runs `pump` (pick the next item if nothing is playing). The constants (`SPACING_MS = 4000`, `ALERT_COOLDOWN_MS = 8000`, watchdog slack) live at the top of the file.

**How each rule is decided** (one `describe` per rule in `rules.test.ts`):

| Rule | Decision |
| --- | --- |
| Priority | Queue is ordered by priority, then `earliestMs`. |
| Preemption | A priority-0 item while a 1/2 item plays: emit its `speak` at once (voice cuts audio locally), log `interrupted` / "preempted by alert" for the old item. A priority-0 item while priority 0 plays: queue it (it will usually expire). |
| Expiry | Checked on arrival, on every tick and right before speaking: `nowMs > expiresMs` → `dropped` / "expired". Items are not spoken before `earliestMs`. |
| Duplicates | `dedupeKey` already spoken or queued → `dropped` / "duplicate". Keys are marked when spoken. |
| Coalescing | Alert of a kind spoken within `ALERT_COOLDOWN_MS` → `coalesced` / "within cooldown". |
| Interrupted cue | Re-queued once (`replayed = true`) if still before `expiresMs`; otherwise `dropped` / "expired after interrupt". |
| Spacing | Priority 1/2 starts no earlier than `lastEndMs + SPACING_MS`. Priority 2 arriving while anything is playing or queued → `dropped` / "busy". |
| Mute | While muted, new priority 1/2 items → `dropped` / "muted". Priority 0 still plays. Whatever is already playing finishes. |
| Repeat | Re-speak `lastCue.text` as a new item (same `sourceId`, new speak id), skips spacing and duplicate checks; `dropped` / "nothing to repeat" if there is no last cue. Honoured even while muted, because it is an explicit request. |
| Camera down | First `camera ok:false` per trip → system item "Camera paused. Route reminders only." with its clip, priority 1. |
| Reset | Returns the initial state (keeps `playing`). Stale `speechEnded` ids are ignored. |
| Paused | Nothing new starts while `playing` is false. Trip time is frozen, so nothing expires either. |
| Watchdog | If `speechEnded` never arrives within `text.length / 14 s + slack` of trip time, treat the item as ended and log it. A broken voice module must not freeze the arbiter. |

Each spoken item gets a unique speak id `${sourceId}#${seq}`, so replays and repeats join to the right `speechStarted` and `speechEnded`.

**`app/src/arbiter/index.ts`** (wrapper): subscribe to `mapCue`, `webcamAlert`, `speechEnded`, `voiceCommand`, `cameraHealth`, `tripState`, `tripReset`; run a 100 ms tick; feed each input to `step` with `clock.nowMs()`; emit effects in order (`speak` before its `spoken` decision); log through `shared/log.ts`. `stop()` clears the interval and unsubscribes.

**Integration test** `arbiter.test.ts`: real arbiter plus the map, vision and voice mocks on a fake clock (like `shared/mocks/mocks.test.ts`). Checks: cue spoken, alert interrupts it, cue replayed once, seek back replays everything once more.

## Phase 3: UI panels

**Timeline** (`app/src/ui/timeline.ts` pure reducer, plus `Timeline.tsx`): one subscription that sees `mapCue`, `webcamAlert`, `speak`, `arbiterDecision`, `speechStarted`, `speechEnded` in bus order and builds one row per source item:
- Columns: trip time, what (cue kind or alert kind), why (the cue or alert `reason`), history of actions (queued → spoken → interrupted → spoken), arbiter reason, first-audible ms.
- This also covers the design's "log for every spoken item": detection time, enqueue time, first audible, final action.
- The latency join goes by speak id: a `spoken` decision attaches the latest `speak` with that `sourceId` (emitted just before it, synchronously). If the team approves `speakId` on `ArbiterDecision`, switch to that.
- Visual: interrupted and dropped rows styled differently, newest row kept in view.
- The reducer is unit-tested.

**Captions**: show the current speech. Set on `speak`, clear shortly after the matching `speechEnded`, clear on `tripReset`. Large type, `aria-live`.

**Data-use panel**: keep the fixed statement word for word; add the trip time to each row.

**Setup screen**: use the exact privacy statement from DESIGN.md "Responsibility and accessibility", plus the "supervised practice, not automated driving" line and the required supervisor check (already there).

**Layout pass**: check the screen against the demo laptop resolution in Chrome; fix spacing, overflow and type sizes until it looks right.

## Phase 4: decisions and requests for the team

Send these early. Each one is listed in KNOWN_GAPS.md.

1. **Contract:** optional `speakId` on `ArbiterDecision` (exact timeline latency). Only Rohit publishes this event, so nobody else breaks.
2. **Contract:** optional `fallbackClipKey` on `SpeakRequest`, set by the arbiter from `featureKind`, so Nithila's network fallback does not have to parse text.
3. **Clip keys:** agree with Nithila and Tejas on `pedestrian`, `followingDistance`, `cameraPaused`, `fallbackTurn`, `fallbackStopSign`, `fallbackCrosswalk`.
4. **Voice behaviour:** what voice does with the current line on `mute` and on `tripState: paused`.
5. **Token endpoint:** approve `api/cartesia-token.ts` as a one-line re-export of `server/cartesia-token.ts`, owned by Nithila; add `api/` to her paths in AGENTS.md. For local dev, either a small `/api` middleware in `vite.config.ts` (Rohit) or `vercel dev`.
6. **React version:** stay on the installed React 19 and update AGENTS.md, or pin 18.
7. **Route type:** turns can live in `features.json` (`turnLeft`/`turnRight` with `street` and `routeDistM`), so `Route` may not need to change. Confirm with Jeev.

## Phase 5: end-to-end tests and integration

- Add Playwright (Rohit approves his own dev dependency) with `channel: 'chrome'`, because Playwright's bundled Chromium cannot play H.264.
- `tests/e2e/replay.spec.ts`: `?mock=map,vision,voice` with the real arbiter on the placeholder video. It checks:
  - Start stays disabled until the supervisor box is ticked.
  - The cue caption appears and the alert caption replaces it.
  - The timeline shows spoken, interrupted and replayed rows.
  - The data-use panel lists the requests.
  - Seeking back clears and refills everything.
  - No console errors.
- Then drop mocks one at a time as each real module passes its owner's checks: map → vision → voice. Repeat the spec and `smoke.md` each time.
- Update `tests/e2e/smoke.md` with: mute/unmute by voice, the camera-paused clip, pause freezes the queue, and the 1x lock.

## Phase 6: demo

- Swap in the real drive video when it is recorded; re-run everything.
- Own the 2-minute script (DESIGN.md "Demo plan"), three rehearsals on the demo laptop, and the backup screen recording with audio.

## Definition of done (from DESIGN.md)

One 1x replay shows real map cues and real vision alerts flowing through the arbiter to Cartesia, with captions, a timeline, a data-use panel and no overlapping audio. The arbiter unit tests cover every rule; the seek reset test and the end-to-end test pass.
