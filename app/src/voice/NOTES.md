# Cartesia Checkpoint 0 spike

Status: Nithila reported successful Sonic warning preparation and clean audible interruption during the local spike. The replacement API key passed both voice-list and token-generation diagnostics. Mic sessions sent audio; final Ink transcript/command recognition is not yet confirmed. This standalone page does not integrate the production voice module.

## Run

From the repository root, install the existing dependencies with `npm ci`.
Create a local `.env` containing `CARTESIA_API_KEY=your_key` using your editor. `.env` is already git-ignored. Do not prefix the key with `VITE_` or paste it into the browser or chat.

Run:

```sh
node --env-file=.env --experimental-strip-types scripts/voice/spikeServer.ts
```

Open http://127.0.0.1:5173/app/src/voice/spike.html in Chrome.
The launcher uses the existing Vite config and serves the production `api/cartesia-token.ts` handler through local middleware without changing anyone else's files. The key stays in the Node process; the browser gets a five-minute token. This launcher binds to loopback. Vercel deployment remains task 10.

## Manual gate

1. Click **Prepare local warning**. This makes a real Sonic WebSocket request for “Pedestrian ahead. Stay alert.” and retains the returned PCM in memory. It is not yet a bundled fixture; reload requires preparing again.
2. Click **Stream reminder**. Confirm the approved University Avenue reminder is audible.
3. While it speaks, click **Interrupt with warning**. Confirm the old sentence stops, the warning plays immediately, and late chunks never resume the sentence. Repeat several times. Also try interrupting while the connection is opening.
4. Hold **Hold to talk**, grant mic permission, wait for “Listening”, say “repeat that”, and release. Confirm Ink's final transcript and the `repeat` command appear. Test mute and unmute, unrelated speech, keyboard Space, permission denial, early release and leaving the window. Mic tracks must stop on release/blur; no audio is sent after release.
5. After preparation, disconnect Wi-Fi and press **Interrupt with warning**. The in-memory clip should still play. This is not the final bundled-clip acceptance test.
6. Record browser, date, selected voice, heard overlap/misses and API errors below. Never record keys, access tokens or WebSocket URLs containing tokens.

## Docs-checked configuration (2026-10-24)

- API version: `2026-08-14` (`Cartesia-Version` server header; `cartesia_version` WebSocket query).
- Token: `POST /access-token`, bearer API key, `{ grants: { tts: true, stt: true }, expires_in: 300 }`; response `{ token }`.
- Sonic: `sonic-3.6`, Skylar voice `db6b0ed5-d5d3-463d-ae85-518a07d3c2b4`; `/tts/websocket`; browser `access_token` query. Full sentence, unique `context_id`, `continue: false`, `max_buffer_delay_ms: 0`; mono raw `pcm_s16le`, 24000 Hz. Voice uses the string ID shown in the current API examples. Claude selects bounded emotion, speed (0.8–1.15) and volume (0.85–1.1) per generated sentence. Vision coaching, answers and generated route wording all forward those settings; templates/clips retain defaults. Optional VITE_CARTESIA_PRONUNCIATION_DICT_ID is a client-visible existing dictionary identifier, not an API key.
- Cancel: `{ context_id, cancel: true }`. Local scheduled nodes are stopped and the active context invalidated before server cancellation. Received chunks for old contexts are ignored.
- Ink: `ink-2`, manual `/stt/websocket`; `encoding=pcm_s16le`, `sample_rate=48000`, `language=en`. Send binary PCM while held, then literal text `finalize`; read final `transcript`, then `close` after `flush_done`. Verify this endpoint/model combination live.
- The mic uses a deprecated ScriptProcessorNode only for this spike (4096 samples, about 85 ms at 48 kHz). Replace with an AudioWorklet before production integration.
- A private spike bus emits `dataSent` and recognized `voiceCommand` events. It uses trip time 0 because there is no replay in this page. It never publishes Rohit's `speak` events. Production integration will use the app's bus and clock.
- The original spike is kept as an early experiment. Production implementations for latency, reconnect, fallback, clip generation and data-use events are described below; no live latency number is claimed without a browser run.

## Verification results

Sonic preparation and audible interruption were reported working by Nithila; final Ink transcription is pending. After task 2, `npm run typecheck`, `npm run lint`, `npm test` (22 tests) and `npm run build` passed. Warning failures now report the token HTTP status, WebSocket close code or Sonic error code without printing credentials. Restart the launcher after server changes.

## Sources

- https://docs.cartesia.ai/build-with-cartesia/tts-models/latest
- https://docs.cartesia.ai/build-with-cartesia/stt/latest
- https://docs.cartesia.ai/api-reference/tts/websocket
- https://docs.cartesia.ai/api-reference/stt/websocket
- https://docs.cartesia.ai/api-reference/auth/access-token
- https://docs.cartesia.ai/get-started/authenticate-your-client-applications

## Execution attempt (2026-10-24)

Started the local launcher and opened the spike in Brave. Clicking **Prepare local warning** failed at the token endpoint with HTTP 401 before any Sonic audio was generated. The authentication diagnostic confirmed one local key entry, a loaded key, and no whitespace, Bearer prefix or quote characters. Both `voices` and `access-token` returned HTTP 401 with both bearer and X-API-Key authentication. No credentials were printed. A valid Cartesia API key must be configured locally before Sonic, interruption or Ink can be live-verified. Typecheck, lint and all 9 tests passed. Chrome audio/microphone acceptance testing remains pending.


## Task 2: production token endpoint

- `api/cartesia-token.ts` exports Vercel's supported named `GET(Request)` handler. It delegates to server-only `scripts/voice/tokenEndpoint.ts`, also used by the local launcher.
- Reads `CARTESIA_API_KEY` only server-side; uses `X-API-Key` (both auth variants passed with the replacement key). Requests only TTS/STT grants, valid for 300 seconds. Responses contain only `{ token }` and are marked `Cache-Control: no-store`.
- Rejects explicit cross-origin requests and unsupported methods. Requests without an Origin are allowed for normal same-origin GETs and CLI clients; this is not user authentication.
- Basic limiter: at most 30 token requests per minute per warm server instance, with `Retry-After`. This is an in-memory, instance-wide demo limit; cold starts and scaling reset or split it. It is not a distributed quota or per-user access control.
- Upstream calls time out after 10 seconds. Invalid responses and network failures become sanitized errors; upstream bodies, keys and tokens are never logged.
- Tests cover speech-only grants, expiry, no-store, response filtering, origin/method checks, missing keys, rate-window reset, upstream failures and malformed token responses. Entry point is imported by the launcher and tests so it is checked despite root tsconfig not listing `api/` explicitly.
- Restart the local launcher and repeat warning preparation to live-test the shared endpoint. Vercel serving, environment variable setup and deployed validation are still pending; no deployment has been performed.


## Tasks 3–6: app streaming, interruption, clip generation and fallback

Implemented in the real voice module (not only the original spike):

- `sonic.ts`: one shared WebSocket per active session, five-minute token fetches, full-sentence Sonic-3.6 requests, same Skylar voice, calm emotion guidance, 24 kHz signed little-endian PCM, immediate buffering, context cancellation, safe parsing, automatic reconnect attempt after a connection drops, and reconnect on subsequent requests if that attempt fails. Text data-use events fire only after a request is sent. A new wire context is allocated for each speak invocation so repeated request IDs after a seek cannot accept old network chunks; application events retain the original request ID.
- `player.ts`: Web Audio chunks scheduled back to back, tracked local nodes that stop immediately, and output-clock-based start notification. Browser output timestamps are used where available, otherwise the audio context clock; this is a browser estimate, not an externally measured speaker latency. Timing uses performance only for latency.
- `engine.ts`: consumes the arbiter's requests and emits speechStarted/speechEnded. Priority zero preempts lower-priority audio, clears every scheduled buffer, cancels upstream and ignores late chunks. It does not interrupt another priority-zero warning. Busy lower-priority requests finish without speech rather than building a second arbiter queue. Unapproved wording, expired requests, unavailable local clips and locked browser sound finish gracefully.
- `index.ts`: preloads clips at module startup, uses the shared bus and replay clock, and clears playback on reset, pause, end and disposal. An interrupted stream cannot revive after reset. `VoicePanel` includes an Enable sound button required by browser audio policies.
- First audio has a 1.5-second deadline measured from receipt of the speak request, including token and connection time. Failure/disconnect/timeout uses the matching preloaded turn, stop-sign or crosswalk fallback; unmatched requests end without speech. A five-second stall watchdog handles an incomplete stream after the first chunk. No network is needed to play preloaded warning audio.
- `npm run clips` now loads `.env`, generates all six approved phrases through Sonic's bytes endpoint with the same voice and calm guidance, writes real raw PCM files and atomically publishes a complete manifest. Content-hashed filenames preserve previously working assets if a later generation fails. It does not create dummy or synthetic replacement audio.

### Pending assets and live checks

Nithila subsequently generated all six real Cartesia clips successfully; the PCM files and complete manifest are now present. Explicit live offline acceptance still needs recording. Run from the project root:

```sh
npm run clips
node --env-file=.env --experimental-strip-types scripts/voice/spikeServer.ts
```

Stop an old launcher with Ctrl+C before starting another. Open http://127.0.0.1:5173/app/src/voice/runtime.html . This new test page directly uses the production player, transport and engine, with a private event bus and a fixed zero trip clock (no video). It does not publish other owners' events. It should show **6/6 bundled clips loaded**. Enable sound, stream a reminder, interrupt with the warning, and reset. Disconnect Wi-Fi after loading, then test the warning and a route fallback. Inspect speechStarted/speechEnded events for correct IDs and interruption status. The page now also exposes the production push-to-talk controller and a latency badge. Mic audio is sent only while its talk button is held.

For the main app use the same launcher, open `/`, and enable sound in VoicePanel. Real map/arbiter/video integration depends on the other owners' implementations; this work does not modify their files. The original `/app/src/voice/spike.html` remains a separate early experiment and does not test this new production engine.

Tests cover PCM conversion, approved wording, transport reuse/reconnect/cancellation, preemption and late chunks, first-audio timeout, missing fallback, expiry, lifecycle/reset/pause, local node cancellation, clip validation, and atomic manifest behavior on generation failure. Full unit tests use simulated transports/audio; live Chrome playback, tone, latency and Wi-Fi-off behavior must still be checked manually with the generated assets.

Clip keys for integration: `pedestrianNearby`, `followingDistance`, `cameraPaused`, `turn`, `stopSign`, `crosswalk`. These keys are defined inside the voice folder and the generated manifest; shared contracts were not edited.

Source for calm emotion: https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion


## Tasks 7–10: latency, Ink, data-use events and deployment preparation

Implemented:

- Latency is measured from receiving `speak` to the first buffer's output-clock timestamp, including connection and queue time. The callback uses `AudioContext.getOutputTimestamp()` to map the scheduled output time to the performance clock; a browser-clock estimate is used where output timestamps are unavailable. Never report network first-chunk time as audible latency. VoicePanel shows the latest `speechStarted.firstAudibleMs`.
- `captureWorklet.js` and `capture.ts` replace the spike's deprecated ScriptProcessor with an AudioWorklet. Mono 20 ms frames minimize unsent audio at release. Mic output is silent (no local monitoring). The actual AudioContext sample rate is advertised to Ink.
- `ink.ts` connects to Ink-2's manual WebSocket with a short-lived token. PCM is sent only during the held session. Release immediately stops capture/tracks; `finalize` drains final transcripts, then `close` shuts down the session. A five-second finalization timeout prevents a stuck UI.
- `pushToTalk.ts` aggregates final transcript segments, accepts only repeat/repeat-that/mute/unmute, ignores other speech and emits `voiceCommand` after the utterance completes. Reset, module stop and a new press invalidate old transcripts. Early release cancels pending mic/token/socket setup; a delayed permission grant cannot leave tracks running.
- VoicePanel supports pointer/touch hold and Space/Enter hold, status messages, release on focus/window loss and hidden page, plus cleanup on unmount. `tripReset`, pause and trip end cancel pending microphone commands.
- TTS emits a `dataSent` event when text is actually sent; each opened Ink session emits a duration-only `dataSent` on release/cancel/error. Duration is based on sent PCM sample counts, with the shared replay clock for `tripMs`. Audio, keys and transcript text are not put in these data-use events.
- Vercel configuration explicitly selects Vite and gives the token function a 15-second duration. The worklet uses Vite's `?no-inline` asset option and is verified as a separate build asset. `scripts/voice/checkDeployment.ts` checks audio files, worklet output and absence of the configured secret from client assets without printing it. `DEPLOYMENT.md` contains the exact account/environment/preview checks.

Verification: typecheck, lint and unit tests passed during implementation. Added tests for delayed permission, cleanup, cancellation, post-release frame suppression, final transcript aggregation, repeat/mute/unmute, unsupported speech, stale sessions, Ink close/timeout handling, AudioWorklet batching and output-clock latency. These are deterministic simulations; live Chrome permission/audio/STT recognition and deployed acceptance still require the demo laptop.

Unfinished external steps: the agent has no Vercel connector/CLI/project linkage and cannot reach Cartesia from its terminal. Nithila ran `npm run clips` successfully and the six generated assets are present. No Vercel deployment or preview URL has been created. Full repeat/mute behavior is owned by Rohit's arbiter, which is still a stub in this checkout; the voice module correctly publishes commands but does not implement his arbitration logic.
