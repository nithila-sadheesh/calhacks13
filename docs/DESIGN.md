# Learner Co-Pilot: Build Design Doc

## Approved revision: video-language coaching

This section is the current architecture, approved by the user during integration. It supersedes conflicting local-only detection, fixed-phrase-only and no-LLM requirements in the original v2 blueprint retained below for history.

**Primary flow:** recorded video → 2–3 resized JPEG frames → server-side Claude Sonnet → validated JSON → `visionAdvice` → arbiter → Sonic → captions/timeline. Map remains context; map speech is optional (`?mapSpeech=1`) and advisory. This is supervised replay coaching, not immediate vehicle control.

- `app/src/vision/index.ts` samples at most once per second; starts analysis after two frames; keeps the latest three; waits at least three seconds between request starts; allows one request in flight.
- `/api/vision-advice` delegates to `server/visionAdvice.ts`. `ANTHROPIC_API_KEY` and optional `ANTHROPIC_MODEL` stay server-side. Default model is `claude-sonnet-5-5`. Native fetch is used; no SDK dependency.
- The server owns the coaching prompt and JSON schema: `{ shouldSpeak: boolean, message: string, reason: string }`. False means an empty message and no speech. Prompt requests one concise, evidence-grounded observation/reminder, preferably 6–12 words. Shared validation caps speech at 180 characters, rejects malformed responses and obvious prohibited claims. Validation cannot guarantee perception or coaching correctness.
- Requests carry only 2–3 JPEG frames, replay timestamps and up to three recent suggestions for repetition control. No map coordinates, microphone audio or client-supplied prompt/model/key. Request body ≤800 KB, each base64 frame ≤240 KB. Per-warm-instance limit: 30 requests/minute; not distributed authentication or quota enforcement.
- Server timeout: 12 seconds; browser timeout: 13 seconds. Pause, seek, reset, trip end and disposal cancel analysis and invalidate responses. Results over eight seconds old in trip time are discarded. Advice expires ten seconds after its latest frame. These are starting values, not latency guarantees.
- `VisionAdvice = { id, text, reason, tripMs, expiresMs }`. Only vision publishes it. `SpeakRequest.origin?: 'vision'` identifies validated generated text. Only arbiter publishes `speak`; voice validates and streams generated text. Video coaching has priority 1, optional map cues priority 2; legacy bundled warnings retain priority 0. New video suggestions replace queued older video/map suggestions without interrupting current ordinary speech. Repeat applies to the latest spoken coaching or route reminder.
- Exact normalized repeated suggestions are suppressed for 20 seconds; the prompt also receives recent suggestions. This is not semantic duplicate detection. Silence is valid. Failures surface in analysis status without fabricated advice or dummy clips.
- Privacy statement: sampled video frames are sent to Anthropic Claude; reminder text is sent to Cartesia Sonic; microphone audio is sent to Cartesia Ink only while push-to-talk is held; GPS coordinates are not sent, but visible locations may be recognizable in video frames. Browser setup and data-use UI must say this.
- UI replaces detection boxes with collecting/analyzing/result/error status, observation, latest advice, analyzed frame time and response latency. The event timeline includes video advice and speech latency.
- MediaPipe code remains available for legacy diagnostics/regression tests only; it does not run in the default app. It is not a second runtime inference pipeline.

**Acceptance:** captured real frames reach the server; malformed/refused/failed responses never speak; valid JSON reaches real arbiter and Sonic transport; no overlapping requests/audio; pause/seek clears stale output; captions match generated speech; keys stay out of client assets; data-use disclosure shows Anthropic uploads. Verify live speaker/mic behavior manually in Chrome. Model latency must be measured, never assumed.

**Measured spike:** one live request with three actual recorded frames returned HTTP 200 and validated coaching JSON in approximately 4.4 seconds. This is one response, not a latency benchmark or safety evaluation. Production deployment and full live-audio acceptance remain pending.

### Instructor guidance revision

The server prompt now lives in `server/coachingPrompt.ts` and includes an extended teaching library and ten written scenarios. See `docs/COACHING_GUIDE.md`. Production JSON additionally requires `observations`, `uncertainties`, `coachingPoint` and `sceneChanged`. Older minimal responses remain accepted only for backward-compatible test doubles on the client.

Frame history is bounded to 20 seconds; requests select one earlier anchor and two recent frames. Up to four prior model observation/uncertainty entries within 20 seconds provide scene context. They are explicitly unverified, cannot establish continuous tracking/arrival order, and clear on reported cuts or replay lifecycle changes. No extra frames or GPS coordinates are uploaded beyond the three-frame limit. The maximum response budget is now 700 tokens for the richer schema.

The optional server `COACHING_JURISDICTION` defaults to unknown. Conditional California examples do not authorize local-law assumptions about unrelated footage. Current prompt/memory improvements are not fine-tuning or proof of instructor competence; source references and testing limits are documented in the coaching guide.

## Original v2 blueprint (historical where superseded)

## Summary

**Pitch:** a voice-first practice-driving companion. It uses the route ahead and an on-device camera to give a few timely, conservative coaching reminders, spoken by Cartesia Sonic, then helps the learner review the drive. Working name: Learner Co-Pilot.

**What it is not:** a driving instructor, a navigation system, or a vehicle safety system. It never decides right-of-way, declares a lane clear, reads traffic-light color, tells anyone to brake, or guarantees a speed limit. A licensed driver drives; a passenger records. The judged demo replays recorded footage; nobody drives on stage.

**MVP, the one demo that must work:** a recorded iPhone drive plays with its GPS track. During playback the app:

1. Fires 2–3 route reminders (turn, stop sign, crosswalk), streamed by Sonic.
2. Detects a pedestrian in the real video frames and interrupts the current reminder with a pre-bundled Sonic warning.
3. Repeats the last reminder when the learner says “repeat that” through Ink (push-to-talk).
4. Shows a timeline of why each cue fired, what was interrupted or dropped, and how fast audio started.

**Packaging:** a web app (React, Vite, TypeScript) deployed on Vercel over HTTPS. The judge view runs in Chrome on a laptop with an external speaker. The same URL installs on an iPhone home screen for a short live-camera moment (stretch).

**Build rules:** one complete, honest vertical slice before any extra feature. English first. No LLM in the driving path. Every route, map and audio-clip fixture is local, so only Sonic streaming and Ink need the network.

### What changed in v2

| Change | Why |
| --- | --- |
| Adopted the feedback's MVP scope: 2–3 safe route cues, one vision alert, push-to-talk Ink | One working slice beats many half-working features |
| Conservative wording; cut lane-drop, unprotected-left, school-zone and “car slowing” alerts | We can't verify them reliably; false authority is a safety and credibility risk |
| Replay video is the master clock; seek resets all cue and queue state | One time source avoids double-fired or stale cues |
| Alert clips are generated with Sonic ahead of time and shipped with the app | Instant, offline-safe, and still Cartesia's voice |
| Interruption must stop local audio buffers, not just cancel server-side | Otherwise old audio keeps playing over the alert |
| Kept three cheap responsibility features: on-screen captions, a data-use panel, a supervisor check | The rubric scores accessibility, privacy and responsible use; these cost about an hour each |
| Rebalanced ownership by folder (section 3) | Even load, no two people editing the same files |
| Added fixture formats, a module interface and AGENTS.md | So four separate agents build to the same rules |

## Rubric map

Every MVP feature answers a judging criterion with a moment judges can see or hear. A feature with no row here waits until after feature freeze.

| Criterion | MVP features | Demo proof | Owners |
| --- | --- | --- | --- |
| Problem and originality | Route-aware reminders generated from map data, not recorded; clear scope (supervised practice only) | A reminder plays before a stop sign, with the reason shown on screen | Jeev, Rohit |
| Use of Cartesia | Sonic streaming for route reminders; Sonic-made alert clips; Ink push-to-talk; first-audible latency badge | Reminder speaks; pedestrian warning cuts it off instantly; “repeat that” works; latency badge visible | Nithila |
| Execution | Replay clock, arbiter with priority and expiry, real frame-based detection, interruption, pause/seek reset, offline alert fallback | Full 1× replay with no overlapping audio; timeline shows spoken, interrupted and dropped cues | Rohit, Tejas |
| Impact and responsibility | Captions for every spoken line; data-use panel; supervisor check; conservative wording; honest limits | Point to captions and the data-use panel; say the limits out loud | Rohit, Nithila, all |

**Rule:** before building anything, name its row. If it has none, it waits.

## Ownership

Each person owns a set of folders outright. Nobody edits another person's folders; modules meet only through the event bus, the shared types and the fixture formats in section 5. The estimated load is roughly equal, about 11–12 focused hours each.

| Person | Feature | Owns (folders) | Delivers | Does not touch |
| --- | --- | --- | --- | --- |
| **Jeev** | Route, map cues, drive fixtures | `app/src/map/`, `scripts/route/`, `scripts/track/`, `fixtures/demo-drive/{route,features,track,annotations}.json` | Route features from OSRM and OpenStreetMap; GPX to `track.json`; route progress; 2–3 timed, safe reminders; Upcoming panel | Replay clock, audio, video, UI layout |
| **Tejas** | Vision and overlay | `app/src/vision/` | Detector on video frames; tracker; pedestrian alert (following-distance fallback); camera-health status; overlay; holdout-clip report | Video element and clock, arbiter, audio |
| **Nithila** | Cartesia voice, server, deploy | `app/src/voice/`, `api/`, `scripts/voice/`, `fixtures/audio/`, Vercel config | Token endpoint; Sonic streaming and playback; local interruption; Sonic-made alert clips; Ink push-to-talk; latency badge; `dataSent` events; deployment | Route logic, vision, UI layout |
| **Rohit** | Replay clock, arbiter, app shell, integration | `shared/`, `app/src/replay/`, `app/src/arbiter/`, `app/src/ui/`, `app/src/main.tsx`, `package.json`, root config, `tests/e2e/` | Event bus and types; video master clock with pause/seek reset; arbiter; layout with panel slots; captions, timeline, data-use panel, supervisor check; smoke tests; demo run | Inside any other module's folder |

**How the UI stays conflict-free.** Rohit's layout has fixed slots. Each owner exports one React component, and Rohit mounts it without editing it:

| Slot | Component | Owner |
| --- | --- | --- |
| Over the video | `VisionOverlay` | Tejas |
| Side panel, top | `UpcomingPanel` (next features, distances, cue reasons) | Jeev |
| Side panel, bottom | `VoicePanel` (push-to-talk button, latency badge, mute) | Nithila |
| Everything else | Video stage, captions, timeline, data-use panel, setup screen | Rohit |

**Shared jobs, single owners.**

- Recording the drive is a team trip; **Jeev** picks the route and converts the GPS track; **Tejas** checks the footage for usable pedestrian moments before conversion.
- `package.json` and root config belong to **Rohit**; ask him to add a dependency.
- Contract changes need Rohit's approval and a message to everyone.
- Each owner fixes their own module when an integration test fails; Rohit reports, doesn't patch.

## Architecture

Four modules, each with one owner, meet only through the event bus. Map and vision report observations; the arbiter decides only when to speak, never whether a maneuver is safe; fixed templates decide what is said.

&#91;embedded content: architecture · owners, events, Cartesia\]

Position also reaches vision (for speed); the arbiter's decisions and Nithila's `dataSent` events also feed the UI. Those lines are left out to keep the drawing readable.

## Shared contracts

Freeze these after Checkpoint 0 (section 11), once a real Sonic call and a real video replay have worked on the demo laptop. Rohit writes them into `shared/`; everyone reviews. Add a field only when a module demonstrably needs it.

**Repo layout**

```text
app/src/
  main.tsx          Rohit: starts every module, mounts panels
  replay/           Rohit: video master clock, pause/seek/reset
  arbiter/          Rohit
  ui/               Rohit: layout, captions, timeline, data-use panel, setup
  map/              Jeev
  vision/           Tejas
  voice/            Nithila
shared/             Rohit: types.ts, bus.ts, mocks/
api/                Nithila: Vercel Cartesia token endpoint
scripts/route/      Jeev: fetch OSRM + Overpass, write fixtures
scripts/track/      Jeev: GPX to track.json
scripts/voice/      Nithila: generate alert clips with Sonic
fixtures/demo-drive/ video.mp4 (team), route.json, features.json, track.json, annotations.json (Jeev)
fixtures/audio/     Nithila: Sonic-made clips + manifest.json
tests/e2e/          Rohit
```

**Module interface.** Every module exports one object; `main.tsx` starts it. Modules never import each other.

```typescript
interface ModuleContext {
  bus: Bus;
  clock: TripClock;
  video: HTMLVideoElement;   // owned by Rohit; others read frames/time only
  fixtures: Fixtures;        // parsed JSON from fixtures/demo-drive
}

interface AppModule {
  name: 'map' | 'vision' | 'voice' | 'arbiter';
  start(ctx: ModuleContext): Promise<void>;
  stop(): void;
}

interface TripClock {
  nowMs(): number;                       // video.currentTime x 1000; track.json already applies its sync offset
  onReset(cb: (tripMs: number) => void): () => void;
}
```

**Events** (`shared/types.ts`)

```typescript
type Position = {
  tripMs: number;
  lat: number; lon: number;
  speedMps: number; headingDeg: number;
  accuracyM?: number;
};

type MapFeatureKind = 'turnLeft' | 'turnRight' | 'stopSign' | 'crosswalk' | 'signal';

type MapCue = {
  id: string;
  featureId: string;        // stable; one cue per feature per trip
  featureKind: MapFeatureKind;
  text: string;             // safe template text, ready to speak
  reason: string;           // e.g. 'stop sign 74 m ahead at 9 m/s'
  priority: 1 | 2;          // 1 = timely coaching, 2 = optional advisory
  earliestMs: number;
  expiresMs: number;
};

type WebcamAlert = {
  id: string;
  kind: 'pedestrianNearby' | 'followingDistance';
  text: string;             // conservative wording; matches the clip
  reason: string;           // e.g. 'person, conf 0.81, 4 of 5 frames, center region'
  confidence: number;
  tripMs: number;
  expiresMs: number;
  clipKey: string;          // key in fixtures/audio/manifest.json
};

type SpeakRequest = {
  id: string;
  sourceId: string;         // the MapCue/WebcamAlert id, for the timeline
  text: string;             // always present: shown as a caption
  clipKey?: string;         // play a bundled clip instead of streaming
  priority: 0 | 1 | 2;      // 0 = vision warning, interrupts
  expiresMs?: number;
};

type ArbiterDecision = {
  sourceId: string;
  action: 'queued' | 'spoken' | 'interrupted' | 'dropped' | 'coalesced';
  reason: string;           // e.g. 'expired', 'cooldown', 'preempted by alert'
  tripMs: number;
};

type DataSent = {
  destination: 'cartesia-tts' | 'cartesia-stt';
  summary: string;          // e.g. 'text: "Stop sign ahead..."' or 'mic audio, 2.1 s'
  tripMs: number;
};

type Events = {
  position: Position;                                         // Jeev
  mapCue: MapCue;                                             // Jeev
  webcamAlert: WebcamAlert;                                   // Tejas
  cameraHealth: { ok: boolean; reason?: string };             // Tejas
  speak: SpeakRequest;                                        // Rohit
  arbiterDecision: ArbiterDecision;                           // Rohit
  tripState: { state: 'idle' | 'playing' | 'paused' | 'ended' }; // Rohit
  tripReset: { tripMs: number };                              // Rohit
  speechStarted: { id: string; firstAudibleMs: number };      // Nithila
  speechEnded: { id: string; interrupted: boolean };          // Nithila
  voiceCommand: { kind: 'repeat' | 'mute' | 'unmute'; transcript: string }; // Nithila
  dataSent: DataSent;                                         // Nithila
};
```

The comment after each event names its only publisher. Anyone may subscribe.

**Fixture formats**

- `track.json` (Jeev): `{ syncOffsetMs: number, points: [{ tMs, lat, lon, speedMps?, headingDeg?, accuracyM? }] }`, where `tMs` is milliseconds since the video's first frame after applying the offset.
- `features.json` (Jeev): `[{ id, kind: MapFeatureKind, lat, lon, routeDistM, street?, source: 'osm' | 'osrm' | 'curated', note? }]`.
- `annotations.json` (Jeev, with Tejas's pedestrian moments): `{ landmarks: [{ tripMs, label }], expected: [{ tripMs, kind }] }`. **Tests only.** Runtime code must never read it; that would make alerts scripted.
- `fixtures/audio/manifest.json` (Nithila): `{ [clipKey]: { file, text, lang, voiceId, model } }`.

**Mocks** (`shared/mocks/`, each a few lines): Jeev's emits scripted positions and cues; Tejas's emits one alert; Nithila's logs `speak` and fakes `speechStarted`/`speechEnded`; Rohit's plays a canned decision stream. Turn on with `?mock=map,vision` in the URL.

## Jeev: route, map cues and drive fixtures

Jeev turns a recorded drive into positions and a few well-timed, safe reminders. This is the originality story: coaching generated from map data on any route, not recorded by an instructor.

**Publishes:** `position`, `mapCue`. **Reads:** `clock`, `tripReset`, `fixtures`. **UI:** `UpcomingPanel`.

### Tasks, in order

1. **Pick the route before recording.** A short loop (4–8 minutes) with at least one left turn, one stop sign and one crosswalk, all present in OpenStreetMap. Check tags on openstreetmap.org first.
2. **Track conversion** (`scripts/track/`). GPX to `track.json`; derive speed and heading from successive points where missing. Set `syncOffsetMs` from the clap at the start of the video, then confirm against two landmarks in `annotations.json`.
3. **Route and features** (`scripts/route/`). Run once: OSRM route with steps, then Overpass for stop signs, crosswalks and signals within 30 m of the route. Write `route.json` and `features.json`. Any hand fix is marked `source: 'curated'` with a note, and we say so if asked.
4. **Position stream.** On each animation frame, interpolate `track.json` at `clock.nowMs()` and emit `position` at about 10 Hz.
5. **Route progress.** Project each position onto the route line and keep the furthest plausible forward distance. Skip cue decisions while `accuracyM` is over 25 m or the match jumps backward. No rerouting or dead reckoning in the MVP.
6. **Cue timing.** For each feature: time to arrival = remaining distance / max(speed, 2 m/s). Emit the cue when time to arrival falls within its window, and set `earliestMs` and `expiresMs` from that window. Speech length counts: estimate 14 characters per second.
7. **One cue per feature.** Track fired `featureId`s; clear them only on `tripReset`.
8. **UpcomingPanel.** Next three features with distance, and the `reason` of the last cue. This is how judges see why a cue fired.

| Feature | Speak when time to arrival is | Drop after | Priority | Text |
| --- | --- | --- | --- | --- |
| Left turn | 9–6 s | 3 s | 1 | “Left turn ahead onto {street}. Check for pedestrians before turning.” |
| Right turn | 8–5 s | 3 s | 1 | “Right turn ahead onto {street}. Check your mirror and blind spot.” |
| Stop sign | 9–6 s | 3 s | 1 | “Stop sign ahead. Prepare for a complete stop.” |
| Crosswalk | 7–5 s | 2 s | 2 | “Crosswalk ahead. Scan both sides.” |
| Traffic light | 8–5 s | 3 s | 2 | “Traffic light ahead. Be ready to stop.” |

Windows are starting values; tune them on the demo drive and record the final numbers here.

**Done when:** on a 1× replay, the same 2–3 cues fire once each, before their features, never after; pause, resume and seek behave; the panel shows the reason.

**Cut from MVP:** rerouting, lane-ends and merge cues, unprotected-left classification, school zones, speed-limit announcements, dead reckoning.

**Stretch (only one stretch for the whole team, chosen at Checkpoint 2):** Spanish templates in `templates.es.json`, paired with Nithila's Spanish voice; or free-drive mode, which cues features along the current road with no destination.

## Tejas: vision and overlay

Tejas makes the app react to what is actually in the video. The alert must come from processed frames, never from a timestamp; that is what makes the execution claim honest.

**Publishes:** `webcamAlert`, `cameraHealth`. **Reads:** `video` frames, `clock`, `position` (speed), `tripReset`. **UI:** `VisionOverlay`.

### Tasks, in order

1. **Frame loop.** Read frames from the shared `<video>` (never create or control it). Downscale to 640 px wide; target 5–10 inferences per second on the demo laptop. Skip frames rather than queue them.
2. **Detector.** MediaPipe Tasks Vision object detector (EfficientDet-Lite0) in video mode; keep person, bicycle, car, truck, bus, motorcycle. If it won't load within the first two hours, switch once to TensorFlow.js COCO-SSD; never maintain both.
3. **Tracker.** Match boxes between frames by overlap (IoU); smooth positions and sizes.
4. **Primary alert: `pedestrianNearby`.** A person with confidence 0.6 or higher, inside a fixed forward region (lower-center trapezoid), seen in at least 4 of the last 5 processed frames. Text: “Pedestrian ahead. Stay alert.” Never say “crossing”.
5. **Fallback alert: `followingDistance`**, only if the pedestrian alert is unreliable on our footage. A vehicle in the forward region whose box width stays above a set fraction of the frame for 2 s while speed is over 5 m/s. Text: “Leave more space ahead.” This is a reminder, never a braking instruction or collision estimate.
6. **Debounce and expiry.** 8 s cooldown per kind; `expiresMs` = detection time + 1.5 s. Clear tracker and cooldown state on `tripReset`.
7. **Camera health.** If inference stalls for 2 s or the video is unavailable, emit `cameraHealth { ok: false }` and stop alerting. No elaborate dark or blocked detection in the MVP.
8. **VisionOverlay.** Boxes with class and confidence, the forward region, and a highlight on the detection behind the current alert, plus the alert's `reason`.
9. **Holdout check.** Run a second short clip with no retuning. Write misses and false alerts in `app/src/vision/HOLDOUT.md`. We report these honestly if asked.

**iPhone footage notes:** confirm the clip is H.264 (not HEVC) and not HDR before tuning; the forward region assumes a landscape mount, low and centered.

**Done when:** at least one alert fires from real detections on the demo clip, the overlay shows which detection caused it, and the holdout report exists.

**Cut from MVP:** lane detection, distance in meters, braking detection, collision timing, traffic-light state, night or rain claims.

**Stretch (if chosen):** live iPhone camera source for a short on-stage moment: point the phone at a teammate walking into frame and the same alert fires.

## Nithila: Cartesia voice, server and deploy

Nithila owns every sound the app makes, everything it hears, and the server. This workstream carries the Cartesia criterion: judges should hear a natural voice, see it start fast, and hear it get cut off cleanly.

**Publishes:** `speechStarted`, `speechEnded`, `voiceCommand`, `dataSent`. **Reads:** `speak`, `tripReset`. **UI:** `VoicePanel`.

| Cartesia product | Role | When |
| --- | --- | --- |
| Sonic, streamed | Speaks route reminders | During replay, when the arbiter says |
| Sonic, pre-generated | Pedestrian, following-distance and fallback clips | Made once by a script, shipped in `fixtures/audio/` |
| Ink-2 | Push-to-talk: “repeat that”, “mute”, “unmute” | Only while the button is held |

### Tasks, in order

1. **Spike first (Checkpoint 0).** A bare test page that makes one Sonic WebSocket call and one Ink call. Confirm against the docs: current model ids (Sonic-3.6 was the newest we found), `Cartesia-Version`, token grants, output encoding, and the STT WebSocket URL and parameters. Write what worked into `app/src/voice/NOTES.md`.
2. **Token endpoint** (`api/cartesia-token.ts`, a Vercel function owned by Nithila). `GET /api/cartesia-token` calls `POST https://api.cartesia.ai/access-token` with the server-side key and returns a short-lived token with `tts` and `stt` grants. Basic rate limit. The key lives only in Vercel environment variables and a git-ignored `.env`.
3. **Sonic streaming.** One WebSocket per session, reconnect on drop. Per request: `model_id`, voice id, full-sentence `transcript`, `context_id` = request id, `continue: false`, `max_buffer_delay_ms: 0`, raw PCM output, calm emotion. Decode chunks and schedule them back to back with Web Audio.
4. **Real interruption.** On a priority-0 request: stop every scheduled `AudioBufferSourceNode` for the current request, clear its queue, mark its id so late chunks are discarded, send the Cartesia cancel message, then play the clip. Emit `speechEnded { interrupted: true }` for the old request.
5. **Alert clips** (`scripts/voice/`). Generate with the same Sonic voice and commit to `fixtures/audio/` with `manifest.json`: “Pedestrian ahead. Stay alert.”, “Leave more space ahead.”, “Camera paused. Route reminders only.”, plus fallbacks “Turn ahead.”, “Stop sign ahead.”, “Crosswalk ahead.” Preload them into memory at startup.
6. **Network fallback.** If streaming fails or the first chunk takes over 1.5 s, play the matching fallback clip if one exists; otherwise emit `speechEnded` and let the arbiter log the drop.
7. **Latency.** `firstAudibleMs` = from receiving `speak` to the moment the first buffer actually starts playing, not when the first chunk arrives. Show the last value in `VoicePanel`.
8. **Ink push-to-talk.** Hold-to-talk button in `VoicePanel`; mic audio streamed to Ink only while held. Keyword-match the final transcript to `repeat`, `mute` or `unmute`; ignore anything else.
9. **Data-use events.** Emit `dataSent` for every Sonic request (the text) and every Ink session (duration only).
10. **Deploy.** Vercel project with the static app and the token function; share the URL with the team by Checkpoint 2.

**Done when:** Sonic speaks a real map cue; a test alert audibly cuts it off with no overlap; “repeat that” works; with wifi off, the pedestrian clip still plays; the latency badge shows a measured number.

**Cut from MVP:** always-on listening, voice control while driving live, generating clips at trip start, a parked LLM debrief.

**Stretch (if chosen):** Spanish voice and clips, paired with Jeev's templates; or a parked two-sentence Q&A grounded only in the trip log, labeled on screen as an LLM call.

## Rohit: replay clock, arbiter, app shell, integration

Rohit owns the skeleton everything plugs into: the shared contracts, the one clock, the arbiter that decides what is heard, and the screens. He coordinates integration but does not fix other people's modules.

**Publishes:** `speak`, `arbiterDecision`, `tripState`, `tripReset`. **Reads:** everything. **UI:** layout, video stage, captions, timeline, data-use panel, setup screen.

### Tasks, in order

1. **Skeleton (Checkpoint 0).** Vite + React + TypeScript (strict), the typed bus, `shared/types.ts`, empty module stubs, mock switch, one debug event log. Repo scripts: `dev`, `build`, `typecheck`, `lint`, `test`.
2. **Replay clock** (`app/src/replay/`). The shared `<video>` element is the only time source: `tripMs` = `video.currentTime` × 1000. Pause, play, reset, and seek publish `tripState`; any seek or reset publishes `tripReset`. Judged run is 1× only.
3. **Arbiter** (`app/src/arbiter/`). One sound at a time, every decision logged as `arbiterDecision`:

| Rule | Behavior |
| --- | --- |
| Priority | 0 vision warning · 1 timely route cue · 2 advisory |
| Preemption | Priority 0 interrupts whatever is playing; nothing interrupts priority 0 |
| Expiry | Drop any cue or alert past `expiresMs` |
| Duplicates | Same `featureId` or alert id is never spoken twice |
| Coalescing | Repeat vision alerts within the cooldown merge into one |
| Interrupted cue | Replay it once only if still before `expiresMs`; otherwise drop |
| Spacing | Non-urgent cues at least 4 s apart; priority 2 dropped if the queue is busy |
| Mute | `voiceCommand: mute` stops priority 1–2 until `unmute`; priority 0 still plays |
| Repeat | `voiceCommand: repeat` re-speaks the last route cue text, if any |
| Camera down | On `cameraHealth { ok: false }`, speak the “Camera paused” clip once |
| Reset | `tripReset` clears the queue, cooldowns, fired ids and last cue |

4. **Layout** (`app/src/ui/`). Video stage on the left with Tejas's `VisionOverlay` slot; side panel with Jeev's `UpcomingPanel` and Nithila's `VoicePanel`; captions under the video; timeline at the bottom.
5. **Captions.** The `text` of the current `speak` request, large type, so every spoken line is also readable.
6. **Timeline.** One row per `arbiterDecision`, with the cue's reason and Nithila's `firstAudibleMs` when spoken.
7. **Data-use panel.** A live list of `dataSent` events under a fixed statement: “Video: stays on this device. Location: not sent. Sent to Cartesia: the lines below.”
8. **Setup screen.** Load the demo drive; a required check: “A licensed adult is in the passenger seat.” One line on what the camera and mic are used for.
9. **Integration.** Swap mocks for real modules one at a time as each passes its own checks. Keep `tests/e2e/smoke.md`, a checklist run before every merge to `main`.
10. **Demo run.** Owns the script in section 13 and runs rehearsals.

**Done when:** one replay shows real map cues and real vision alerts flowing through the arbiter to Cartesia, with captions, a timeline, a data-use panel, and no overlapping audio.

**Cut from MVP:** IMU workload gating, live-driving screen lock, settings screens, map animation, an edge-case injection UI.

## Responsibility and accessibility

The rubric scores accessibility, privacy and responsible use, so the MVP carries small, real versions of each instead of promises on a slide.

| Area | MVP feature | Owner | What judges see |
| --- | --- | --- | --- |
| Accessibility | Captions for every spoken line | Rohit | Text under the video matches the voice |
| Accessibility | Voice-first: nothing to read or tap while driving; push-to-talk is for the supervisor or a parked learner | Nithila, Rohit | Drive view needs no interaction |
| Accessibility | “Mute” and “unmute” by voice; safety warnings still play | Nithila, Rohit | Say “mute”; reminders stop, warnings don't |
| Privacy | Video frames processed in the browser, never uploaded or stored | Tejas | Data-use panel: “Video: stays on this device” |
| Privacy | Only reminder text goes to Sonic; mic audio goes to Ink only while push-to-talk is held | Nithila | Data-use panel lists each request |
| Privacy | Cartesia key stays server-side; the browser gets short-lived tokens | Nithila | Mention in Q&A |
| Responsible use | Supervisor check before every drive | Rohit | Setup screen |
| Responsible use | Conservative fixed wording; no braking orders, right-of-way calls or light-color claims | Jeev, Tejas | Every caption |
| Responsible use | Spacing and mute to limit distraction | Rohit | Timeline shows dropped advisories |

**The exact privacy statement** (use these words): video frames stay on the device; spoken reminder text is sent to Cartesia Sonic; microphone audio is sent to Cartesia Ink only while push-to-talk is held; the demo uses saved map data, so no location is sent during replay.

**Limits we say out loud:** detection misses things and is untested at night or in rain; distances are approximate; map data can be incomplete, and any hand corrections are labeled; we have not measured whether reminders improve learner driving, and that needs a real study.

## Checkpoints

Nobody starts the next phase until the gate passes on the demo laptop. Merge to `main` at every checkpoint.

&#91;embedded content: build timeline · 5 phases, 4 checkpoints\]

| Checkpoint | Jeev | Tejas | Nithila | Rohit |
| --- | --- | --- | --- | --- |
| 0: spikes | Short track fixture emits positions synced to a sample video | Detector draws boxes on that video | One streamed Sonic sentence interrupted by a local clip; one Ink transcript | Repo, bus, module stubs, mock switch, event log |
| 1: contracts + footage | Demo drive recorded and converted; route and features fixtures; mock emits real-looking cues | Footage reviewed for pedestrian moments; mock emits one alert | Token endpoint; alert clips generated and committed; mock logs speak requests | Types frozen; replay clock with seek reset; app runs with all mocks |
| 2: MVP end to end | 2–3 cues fire correctly on the real drive | Frame-based alert fires on the real clip; overlay | Streaming, interruption, push-to-talk repeat, latency badge; deployed URL | Arbiter, captions, timeline, data-use panel, setup; full 1× replay passes the smoke checklist; team picks one stretch, or none |
| 3: freeze | Failure tests pass | Holdout report written | Offline clip test passes | Stretch done or dropped; backup recording made |

**If a gate fails,** simplify the failing slice right away rather than waiting: fewer cue types, the fallback alert, or bundled-only audio.

## Acceptance tests

Every test has exactly one owner, who makes it pass on the demo laptop. Cross-module behavior is tested by the person who owns the deciding module; others only fix their own side if it fails.

| Test | Pass condition | Owner |
| --- | --- | --- |
| Track sync | At the two annotated landmarks, video and position agree within 1 s; pause/resume stays aligned | Jeev |
| Cue timing | 2–3 cues fire once each, inside their windows, never after the feature | Jeev |
| GPS quality | Points with accuracy over 25 m or a backward jump produce no cue | Jeev |
| Frame-based alert | Pedestrian alert fires from detections on the demo clip; disabling the detector removes it | Tejas |
| Holdout clip | Second clip run with no retuning; misses and false alerts written down | Tejas |
| Camera health | Pausing inference for 2 s emits `cameraHealth { ok: false }` | Tejas |
| Streaming | A fresh route cue speaks through Sonic; `firstAudibleMs` is measured and shown | Nithila |
| Local interruption | A priority-0 clip stops current audio with no overlap; late chunks are discarded | Nithila |
| Offline clip | With wifi off, the pedestrian clip plays | Nithila |
| Ink repeat | Holding push-to-talk and saying “repeat that” emits `voiceCommand: repeat` | Nithila |
| Token safety | No Cartesia key in the client bundle or git history | Nithila |
| Arbiter rules | Unit tests cover every rule in Rohit's table | Rohit |
| Seek reset | Seeking back replays cues once more, with no stale queue or cooldown | Rohit |
| End to end | Full 1× replay: cues, one alert interrupting a cue, repeat, captions, timeline; no overlap, no console errors | Rohit (coordinates), everyone fixes their own |

**Log for every spoken item:** detection or cue time, enqueue time, first-audible time, and final action (spoken, interrupted, dropped). Quote only measured latencies.

## Demo plan

The footage and GPS are prerecorded; cue generation, detection, arbitration and speech all happen live during the replay. Rohit runs the script; everyone rehearses it three times on the demo laptop.

### Recording the drive (whole team, early)

- A licensed driver drives normally; a passenger operates the phones. No staged hazards; drive a street where pedestrians are common.
- **iPhone camera settings:** Settings → Camera → Formats → Most Compatible (H.264); HDR video off; 1080p at 30 fps; landscape; mounted low and centered behind the windshield.
- **GPS:** a GPS logger app (for example, Open GPX Tracker) running at the same time, ideally on a second phone. Export the `.gpx`.
- **Sync:** clap on camera right after both start.
- Record 15–20 minutes so there are spare moments; cut a 2-minute demo clip and keep one short holdout clip for Tejas.

### Script (about 2 minutes)

| Time | Action | What it proves |
| --- | --- | --- |
| 0:00 | Setup screen: supervisor check; “this is supervised practice, not automated driving” | Scope, responsibility |
| 0:15 | Replay starts; a stop-sign reminder plays; Upcoming panel shows why | Originality, Sonic |
| 0:35 | Boxes appear on a pedestrian; the warning cuts off the current reminder; latency badge updates | Real vision, arbiter, Cartesia speed |
| 0:55 | Timeline: what was spoken, interrupted, dropped, and how fast | Execution |
| 1:10 | Hold push-to-talk: “repeat that” | Ink, two-way voice |
| 1:25 | Captions and the data-use panel | Accessibility, privacy |
| 1:40 | State the limits in one breath | Honesty |

### Stage setup and backups

- External speaker and a headset or handheld mic for Ink.
- All route, track, video and clip fixtures are local; a phone hotspot backs up the venue wifi for Sonic and Ink.
- A screen recording, with audio, of a clean full run. If something fails live, say so and switch to it.
- 1× speed only. If a road feature was hand-corrected, say so.

## Risks and truthful claims

| Risk | Owner | What we do |
| --- | --- | --- |
| Footage has no clean pedestrian moment | Tejas | Record 15–20 minutes in a busy area; fall back to the following-distance reminder |
| OSM missing or wrong features on the route | Jeev | Check tags before driving; label curated fixes; use only verified cue types |
| Audio overlap or stale audio after interrupt | Nithila | Build local cancellation in the Checkpoint 0 spike, before any feature |
| Venue network slow or down | Nithila | Bundled clips cover warnings; hotspot; the latency badge shows real numbers either way |
| Video and GPS drift apart | Jeev | Two annotated landmarks; adjust `syncOffsetMs` |
| Modules never meet | Rohit | Mocks from hour one; merge at every checkpoint |
| Too much scope | Everyone | One stretch for the whole team, chosen at Checkpoint 2; feature freeze at Checkpoint 3 |
| Hall noise defeats Ink | Nithila | Headset mic; rehearse in a noisy room; backup video |

**Never claim:** zero false alerts, collision timing, verified speed limits, full scene understanding, or improved safety without a study.

**A defensible future extension** (for Q&A, not the MVP): the supervisor tags a learning focus, such as mirror checks, and the app prioritizes the matching reminders at verified situations.

## Agents

Each teammate's coding agent (Claude Code or Codex) follows one shared ruleset, `AGENTS.md`, at the repo root. Codex reads `AGENTS.md` automatically; Claude Code reads `CLAUDE.md`, which contains a single import line pointing at `AGENTS.md`, so both tools load the same rules.

**What AGENTS.md enforces**

- Each agent confirms which person it works for, then edits only that person's folders (section 3 of this doc).
- Contracts in `shared/` are frozen; agents propose changes instead of working around them.
- Modules talk only through bus events, each with one publisher.
- One clock, reset on `tripReset`; nothing scripted from `annotations.json`.
- Approved phrases only; no LLM in the driving path; no video or location over the network; no secrets in the client or git.
- Typecheck, lint and tests before any “done”.

**Setup (Rohit, at Checkpoint 0)**

1. Commit `AGENTS.md` and `CLAUDE.md` at the repo root.
2. Export this doc as Markdown to `docs/DESIGN.md`, and re-export it if the plan changes.
3. Create `shared/log.ts` (referenced by AGENTS.md) and set up Git LFS for `fixtures/demo-drive/video.mp4`.

**Starting a session** (everyone): open the agent in the repo and say who you are and what task you're on, e.g. “I'm Tejas. Do task 4 in my section of docs/DESIGN.md.” The agent takes it from there under the shared rules.

## Sources

- [Cartesia: Authenticate your client apps](https://docs.cartesia.ai/get-started/authenticate-your-client-applications)
- [Cartesia: API conventions](https://docs.cartesia.ai/use-the-api/api-conventions)
- [Cartesia: TTS WebSocket API reference](https://docs.cartesia.ai/api-reference/tts/websocket)
- [Cartesia: TTS WebSocket buffering](https://docs.cartesia.ai/use-the-api/tts-websocket/buffering)
- [Cartesia: Real-time speech-to-text quickstart](https://docs.cartesia.ai/ja-jp/get-started/realtime-speech-to-text-quickstart.md)
- [Cartesia blog: Sonic-3.6](https://cartesia.ai/blog/sonic-3.6/)
- [OSRM API](https://project-osrm.org/docs/v5.24.0/api/)
- [OpenStreetMap: Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)
