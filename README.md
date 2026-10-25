# Voya - a voice co-pilot for learner drivers

Voya (codename Learner Co-Pilot) is a calm, spoken coach for **supervised** practice drives. A phone on the dashboard watches the road through its camera, follows the route by GPS, and talks the learner through what is coming up: a stop sign ahead, a cyclist on the right, a turn onto the next street. The learner can also tap once and ask a question out loud ("what does a flashing yellow mean?", "repeat that", "mute"), and get a short spoken answer.

Everything is spoken so the learner never has to look at the screen. Captions show each line for the supervisor.

**Try it:** https://learner-copilot-ten.vercel.app?_vercel_share=H4bC3GofUEuPJZu2FCiWokznIXFJFDZJ

> Voya is a practice aid, not a safety system. A licensed adult must supervise every drive. It never tells the driver to brake, never says a road or lane is clear, never decides right-of-way, and never states a light color or speed limit.

---

## Using the live app

Open the link above in Chrome (laptop) or Safari/Chrome (phone). Tick the box confirming a licensed adult is in the passenger seat, then pick a mode.

### Demo drive (recommended for judging, works on a laptop)

1. Click **Load demo drive**. A recorded dashcam clip loads with its route.
2. Click **Enable replay sound** (browsers need one tap before they play audio).
3. Press play on the video.
4. Watch the blue boxes appear as the on-device detector finds people, cars, bikes and signs. Within a few seconds Voya starts speaking. Each line also appears in the captions under the video.
5. Tap the **microphone** button, ask a question, and tap again to send. Try "what should I check before a right turn?", "repeat that" or "mute".
6. Open **Timeline** at the bottom to see every decision: what was detected, what Claude suggested, what was spoken, dropped or queued, and why. **Data use** lists everything that left the device.

### Live drive (phone, in a car)

1. Mount the phone with the rear camera facing the road. Click **Start live drive**, then **Start drive**, and allow camera, location and microphone.
2. Voya coaches from the live camera feed and speaks route reminders when GPS shows you approaching a mapped stop sign, crosswalk or turn.
3. Tap the microphone to ask a question. Tap **End drive** when finished.

On iPhone, speech stays audible even with the ring/silent switch on.

---

## How it works

```
 camera / video ──> on-device object detector ──> scene summary (JSON, no images)
                     (EfficientDet-Lite0, ~8 fps)           │
                                                            v
 GPS + mapped route ──> route reminders           Claude: what is worth saying, and how it should sound
          │                                                 │
          └──────────────> arbiter (one line at a time, priorities, spacing, repeat/mute)
                                       │
                                       v
                     Cartesia Sonic (streamed speech) ──> speaker + captions

 microphone (only between two taps) ──> Cartesia Ink (speech-to-text) ──> Claude answer ──> arbiter
```

- **Vision runs on the device.** Video frames never leave the phone or laptop. The detector and tracker turn frames into a short description (object class, left/centre/right, growing or shrinking, how long it has been visible) and only that text goes to Claude.
- **Claude is the reasoning engine.** It decides whether anything is worth saying, words one short coaching sentence, and picks the voice settings for that sentence. It also words the route reminders ahead of time and answers the learner's spoken questions. It is told to stay silent when nothing useful is supported, and to pace itself using how long the voice has been quiet. When Claude has nothing new, a short local reminder fills long silences.
- **The arbiter** (`app/src/arbiter/`) is a small rule engine that decides what is actually spoken: one line at a time, safety clips interrupt everything, answers to the learner come before coaching, stale lines expire, and lines never run back to back.
- **Every generated line is filtered** (`shared/safeWording.ts`, `shared/coaching.ts`) before it can be spoken, so banned phrasing (braking commands, "clear", right-of-way, light colors, speed limits) never reaches the speaker.

---

## Cartesia features we used

| Feature | How Voya uses it | Where |
| --- | --- | --- |
| **Sonic 3.6 streaming TTS over WebSocket** | Every spoken line (coaching, route reminders, answers) is streamed as raw 16-bit PCM at 24 kHz and played as chunks arrive, so speech starts in a few hundred milliseconds. One socket is opened ("warmed") before the drive starts and reused for every line. | `app/src/voice/sonic.ts` |
| **Per-sentence `generation_config`** | Claude chooses `emotion` (11 options: calm, confident, determined, curious, contemplative, neutral, peaceful, sympathetic, content, grateful, enthusiastic), `speed` (0.75-1.3) and `volume` (0.75-1.25) for each sentence. A new stop sign sounds firm and slightly louder; an explanation is slower and reflective; reassurance is softer. Values are validated against a safe band before they reach Sonic. | `shared/delivery.ts`, `app/src/voice/sonic.ts` |
| **Context IDs and cancellation** | Each line has its own `context_id`. When a safety warning or the learner's question interrupts a line, Voya sends a cancel for that context and drops any late audio for it. | `app/src/voice/sonic.ts`, `app/src/voice/engine.ts` |
| **Low-latency settings** | `max_buffer_delay_ms: 0` and `continue: false` so each short sentence is synthesized immediately. | `app/src/voice/sonic.ts` |
| **Ink-2 streaming speech-to-text** | Push-to-talk: the first tap opens the microphone and an Ink WebSocket, audio streams as PCM, the second tap finalizes the transcript. "Repeat", "mute" and "unmute" are handled instantly; anything else goes to Claude as a question. | `app/src/voice/ink.ts`, `app/src/voice/pushToTalk.ts` |
| **Short-lived access tokens** | The browser never sees the API key. It asks our server (`/api/cartesia-token`), which calls Cartesia's `/access-token` with `tts` and `stt` grants and a 5-minute expiry. | `api/cartesia-token.ts`, `scripts/voice/tokenEndpoint.ts` |
| **Sonic batch TTS (`/tts/bytes`) for bundled clips** | Safety warnings ("Pedestrian ahead. Stay alert.") and network fallbacks ("Stop sign ahead.") were generated once with the same voice and ship with the app, so they play instantly and still work if the network is slow. If streamed speech has not started within 1.5 s, a route reminder falls back to its clip. | `scripts/voice/generateClips.ts`, `fixtures/audio/` |

Voice playback also includes a loudness stage (gentle compression plus make-up gain) so speech is clear on a phone speaker over road noise without clipping, and an iOS audio-session fix so speech plays with the silent switch on.

---

## Running it locally

### Prerequisites

- Node.js **22.6 or newer** and npm
- [Git LFS](https://git-lfs.com) (the demo video is stored with LFS)
- Google Chrome (the test suite and demo video use it)
- A **Cartesia** API key and an **Anthropic** API key

### Steps

```bash
git lfs install
git clone https://github.com/nithila-sadheesh/calhacks13.git
cd calhacks13
npm install
cp .env.example .env
```

Open `.env` in an editor and fill in:

```
CARTESIA_API_KEY=your_cartesia_key
ANTHROPIC_API_KEY=your_anthropic_key
```

Keys stay on the server side only; they are never bundled into the browser code. Then:

```bash
npm run dev
```

Open http://localhost:5173 and follow **Using the live app** above. The `/api/*` routes run locally with the same code Vercel uses.

### On a phone (live camera and GPS)

Phones only allow camera, microphone and location on HTTPS pages. `npm run phone` serves the dev app over HTTPS on your local network with a self-signed certificate and prints the address to open. Accept the certificate warning once. The deployed Vercel link above already uses HTTPS.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server with the API routes |
| `npm run phone` | Same, over HTTPS for phone testing |
| `npm run build` | Type-check and build for production |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run e2e` | Browser tests in Chrome (Playwright) |
| `npm run typecheck`, `npm run lint` | Static checks |
| `npm run clips` | Regenerate the bundled voice clips with Sonic |

Add `?mock=vision,voice` (any of `map`, `vision`, `voice`, `arbiter`, `assistant`) to the URL to swap a module for a scripted stand-in, for testing without keys.

### Deploying

The app deploys to Vercel as a Vite site plus three serverless functions (`api/assistant.ts`, `api/vision-advice.ts`, `api/cartesia-token.ts`). Set `CARTESIA_API_KEY` and `ANTHROPIC_API_KEY` in the Vercel project's environment variables. Optional: `ANTHROPIC_MODEL` (defaults to `claude-sonnet-5-5`) and `COACHING_JURISDICTION`.

---

## Privacy

- **Video frames stay on the device.** Only a text description of detected objects is sent to Claude. No images, GPS coordinates or audio go to Claude.
- **Only the words to be spoken** go to Cartesia Sonic.
- **Microphone audio** goes to Cartesia Ink only between your two taps of the microphone button.
- The **Data use** panel lists every outbound request as it happens.

---

## Known limitations

**Perception**
- The on-device detector recognizes eleven classes: person, bicycle, car, truck, bus, motorcycle, train, stop sign, traffic light, dog and cat. It can misclassify, especially small or distant objects, and it does not see lane markings, crosswalk paint, other signs or the road surface.
- It works in image space only. A "growing" box is not a measured distance or speed, and a person box cannot tell a pedestrian from someone inside a car. Voya therefore never estimates distances, closing speed or collision timing.
- It cannot tell which approach a stop sign or light controls, who arrived first at a junction, or what color a light is. Coaching stays at "prepare for a complete stop" and "be ready to stop".

**Coaching and timing**
- Claude takes roughly 2-6 seconds to respond, so coaching about a new object lags slightly behind the scene. Urgent warnings would need the bundled clips, not generated speech.
- Claude chooses silence when the evidence is weak. In a quiet scene, a local reminder fills the gap after about 4 seconds at the start, then every 12-20 seconds of silence.
- Coaching and answers need a network connection to Claude and Cartesia. If Sonic is slow or unreachable, route reminders fall back to bundled clips, but Claude's coaching sentences have no clip and are skipped.
- Traffic-law guidance defaults to "jurisdiction unknown", so Voya explains general habits rather than state-specific rules.

**Route and GPS**
- Route reminders come from a small mapped stretch in Berkeley (around Dwight Way: a stop sign, a crosswalk and a right turn), fetched ahead of time from OpenStreetMap/OSRM. Away from that stretch, live drives get vision coaching and answers but no route reminders.
- The demo drive is an 11-second clip with a placeholder GPS track, so its route reminder illustrates the feature rather than being synced to the exact spot in the video.
- Phone GPS can be off by several meters, which shifts when a reminder fires.

**Voice and devices**
- Speaking to Voya is push-to-talk (tap, speak, tap). There is no hands-free wake word in this version.
- English only.
- Camera, microphone and GPS need HTTPS and browser permission. Tested in desktop Chrome and on iPhone (Safari/WebKit); other browsers may differ.

**Infrastructure**
- Server-side rate limiting is per warm serverless instance, not a global quota, and the API routes have no user accounts or authentication beyond same-origin checks.

---

## Project layout

```
app/src/
  vision/     on-device detection, tracking, scene summary, Claude coaching requests
  map/        GPS, route matching, route reminders
  voice/      Cartesia Sonic + Ink, audio playback, push-to-talk
  arbiter/    decides what is spoken and when
  assistant/  sends the learner's questions to Claude
  ui/         app shell, captions, mic button, timeline, data-use panel
  replay/     trip clock for the demo video and live drives
api/          Vercel serverless entry points
server/       Claude prompts and request handling
shared/       event types, validation, safe-wording filter, voice settings
fixtures/     demo video, route data, bundled voice clips
docs/         design notes and coaching guide
```

Built at Cal Hacks by Rohit, Nithila, Tejas and Jeev.
