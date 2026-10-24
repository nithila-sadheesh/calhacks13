# Vercel deployment and acceptance

The implementation is prepared for Vercel but has not been deployed by the agent. No Vercel connector, CLI or linked project is available in the agent environment, which also cannot reach Cartesia. No public URL is claimed.

## Before deployment

1. From the repo root run `npm run clips`. This must create all six real PCM files and update `fixtures/audio/manifest.json`. Nithila has generated all six clips; rerun only if the voice or phrases change.
2. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
3. Run `node --env-file=.env --experimental-strip-types scripts/voice/checkDeployment.ts`. This checks the six audio assets, the built AudioWorklet and absence of the configured API key in the client bundle. It never prints the key.
4. Review and commit only your files on `nithila/voice-setup`; do not merge main or include `.env`. GitHub-connected deployments only include committed/pushed files, not the current uncommitted workspace.

## Connect Vercel

- Import `nithila-sadheesh/calhacks13` into your Vercel account, or select the team's existing project if one exists.
- Root directory: repository root. Framework: Vite. Build: `npm run build`. Output: `dist`. The supplied `vercel.json` sets these and a 15-second limit for `api/cartesia-token.ts`.
- Add `CARTESIA_API_KEY` as a **server** environment variable for Preview and Production. Do not use a `VITE_` prefix. Enter the current valid key yourself in Vercel, not in source files or deployment logs.
- Deploy your branch as a Preview. Do not change the production branch or merge main as part of this step.
- The `/api/cartesia-token` function is discovered by Vercel from `api/cartesia-token.ts`; Sonic and Ink WebSockets connect directly from the browser to Cartesia using its temporary tokens.
- The app needs the other owners' footage and real map/arbiter implementations for a full trip. A deployed app shell alone does not prove end-to-end integration.

## Verify the preview

Open the preview in Chrome. Check `/api/cartesia-token` returns 200 without copying or sharing its token. Confirm the response is `Cache-Control: no-store`. Never paste token URLs or tokens into team messages.

The local voice test pages (`/app/src/voice/runtime.html` and the original spike) are dev-only entry points and are not part of the default production build. Use the actual app in the deployed preview.

1. Enable sound before replay; hear a route cue and see First audible update only after playback starts.
2. Trigger a real vision warning through the team's arbiter. Confirm the route sound stops without overlap and its end event has `interrupted: true`.
3. Hold the talk button, wait for Listening, say “repeat that”, release. Confirm `voiceCommand: repeat`; the arbiter owns replaying the reminder. Also test “mute” and “unmute”; warnings must still play under mute. Voice publishes commands and does not implement a second arbiter.
4. Keyboard Space/Enter and pointer/touch must stop mic capture on release, focus loss, hidden page and trip reset. Confirm Chrome's mic indicator clears. Try denying permission and retrying.
5. Disconnect Wi-Fi after the app has loaded the audio assets. Pedestrian warning must play. A turn reminder should use “Turn ahead.” after streaming fails or the first-audio deadline expires. Reloading the entire app while offline is not supported (no service worker).
6. The data-use panel shows TTS text and STT session duration only. No video, location or microphone transcript belongs in `dataSent`. Commands include the transcript only in the shared `voiceCommand` event required by the contract.
7. Test on the actual demo laptop with its external speaker/headset. Browser output-clock latency is an estimate of audible start, not an external acoustic measurement. Rehearse in a noisy room and keep a backup recording.

## Limits

The basic token limiter allows 30 requests per minute per warm function instance. It is not distributed user authentication; cold starts and scaling split/reset it. Preview/deployment protection and a stronger quota can be configured by the team as needed before broader public use. Production acceptance and the preview URL remain pending until the above checks are performed.
