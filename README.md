# Voya - a voice co-pilot for learner drivers

Voya is a calm, spoken coach for supervised practice drives. A phone on the dashboard watches the road through its camera, follows the route by GPS, and talks the learner through what matters: a stop sign ahead, a cyclist on the right, a turn onto the next street. The learner can also tap once and ask a question out loud ("what should I check before a right turn?", "repeat that", "mute") and hear a short answer.

Everything is spoken, so the learner keeps their eyes on the road. Captions show each line for the supervisor.

**Live app:** https://learner-copilot-ten.vercel.app?_vercel_share=H4bC3GofUEuPJZu2FCiWokznIXFJFDZJ

## How it works

```
camera ──> on-device object detector ──> scene description (text only, no images)
                                                   │
                                                   v
GPS + mapped route ──> route reminders     Claude: what to say, and how it should sound
          │                                        │
          └──────> arbiter: one line at a time, priorities, spacing, repeat/mute
                                   │
                                   v
                 Cartesia Sonic (streamed speech) ──> speaker + captions

microphone (only between two taps) ──> Cartesia Ink ──> Claude answer ──> arbiter
```

- **Vision runs on the device.** Video never leaves the phone. A local detector and tracker describe what they see (object, position, whether it is getting closer in the frame), and only that text goes to Claude.
- **Claude is the reasoning engine.** It decides whether anything is worth saying, writes one short coaching sentence, chooses how that sentence should sound, and answers the learner's questions.
- **The arbiter** decides what is actually spoken: one line at a time, answers before coaching, stale lines expire, and lines never run back to back.
- **Safety filter.** Every generated line is checked before it is spoken. Voya never tells the driver to brake, never says a road is clear, never decides right-of-way, and never states a light color or speed limit. A licensed adult supervises every drive.

## Setup steps

### Use the live app (no install)

1. Open the live app link above in Chrome on a laptop, or Safari/Chrome on a phone.
2. Tick the box confirming a licensed adult is in the passenger seat.
3. Pick a mode:
   - **Load demo drive** (easiest on a laptop): click **Enable replay sound**, then press play. Blue boxes mark what the detector sees, and within a few seconds Voya starts coaching out loud.
   - **Start live drive** (phone in a car): mount the phone facing the road, tap **Start drive**, and allow camera, location and microphone.
4. Tap the **microphone** button, ask a question, and tap again to send.
5. Open **Timeline** to see every decision (what was detected, what Claude suggested, what was spoken and why). **Data use** lists everything that left the device.

### Run it locally

Requirements: Node.js 22.6+, [Git LFS](https://git-lfs.com) (for the demo video), Chrome, a Cartesia API key and an Anthropic API key.

```bash
git lfs install
git clone https://github.com/nithila-sadheesh/calhacks13.git
cd calhacks13
npm install
cp .env.example .env      # then add CARTESIA_API_KEY and ANTHROPIC_API_KEY
npm run dev               # open http://localhost:5173
```

Keys stay on the server; the browser only ever receives short-lived Cartesia tokens.

- **On a phone:** `npm run phone` serves the app over HTTPS on your local network (phones require HTTPS for camera, microphone and GPS). Open the address it prints and accept the certificate warning once.
- **Tests:** `npm test` (unit and integration) and `npm run e2e` (browser tests in Chrome).
- **Deploy:** the app deploys to Vercel as a Vite site plus three serverless functions in `api/`. Set `CARTESIA_API_KEY` and `ANTHROPIC_API_KEY` in the Vercel project settings.

## Cartesia features we used

| Feature | How Voya uses it |
| --- | --- |
| **Sonic 3.6 streaming TTS (WebSocket)** | Every spoken line streams as 24 kHz PCM and starts playing as the first chunk arrives, typically within a few hundred milliseconds. The socket is opened before the drive starts and reused for every line. |
| **Per-sentence `generation_config`** | Claude picks the `emotion` (11 options, such as determined, calm, curious, sympathetic), `speed` and `volume` for each sentence. A new stop sign sounds firm and a little louder; an explanation is slower; reassurance is softer. Values are validated before they reach Sonic. |
| **Context IDs and cancellation** | Each line gets its own `context_id`. When the learner asks a question or a warning interrupts, Voya cancels that context so no stale audio plays. |
| **Low-latency settings** | `max_buffer_delay_ms: 0` and `continue: false`, so each short sentence is synthesized immediately. |
| **Ink-2 streaming speech-to-text** | Push-to-talk: the first tap opens an Ink session, the second tap finalizes the transcript. "Repeat", "mute" and "unmute" run instantly; anything else goes to Claude as a question. |
| **Access tokens** | Our server exchanges the API key for a 5-minute token with `tts` and `stt` grants, so the key never reaches the browser. |
| **Batch TTS (`/tts/bytes`)** | Safety warnings and route fallbacks were pre-generated in the same voice and ship with the app. They play instantly, and stand in for a route reminder if streamed speech is slow. |

Playback also adds a loudness stage so speech stays clear on a phone speaker over road noise, and an iOS audio setting so speech plays even with the silent switch on.

## Known limitations

These are the main gaps we would close with more time:

- **Perception is 2D.** The detector recognizes common road objects (people, cyclists, vehicles, stop signs, traffic lights) but works in image space: it cannot measure real distance or speed, read lane markings, or tell which approach a sign controls. Depth estimation or a dedicated road-scene model would let coaching get more specific.
- **Coaching has a short delay.** Claude takes a couple of seconds to respond, so coaching about a brand-new object arrives slightly after it appears. A faster or on-device model for the first pass would shorten this.
- **Route reminders cover mapped areas only.** Stop signs, crosswalks and turns come from map data prepared ahead of time for our test area. Elsewhere, Voya still coaches from the camera and answers questions; fetching map data on the fly would extend reminders everywhere.
- **Push-to-talk and English only.** Asking a question takes two taps, and Voya currently speaks and listens in English. A hands-free wake word and more languages are natural next steps.

Built at Cal Hacks by Rohit, Nithila, Tejas and Jeev.
