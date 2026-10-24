# Instructor-style coaching guide

## Current hybrid input

Production now supplies local detector/tracker JSON, not images. Claude sees object classes, tentative IDs, confidence, image-side/zone, camera-relative displacement, apparent-size trend and observed duration. It receives up to three prior detector snapshots and four recent textual observation entries. Unknown controls, lane topology, physical distance, speed, parking state, sign applicability and arrival order cannot be recovered by prompting alone. Written examples with those facts are conditional teaching references, never permission to invent them. A basic person detector also cannot distinguish a pedestrian from a vehicle occupant.

The runtime performs local inference while Claude works; one request at a time and a three-second minimum avoid sending every frame. Nonempty unchanged scenes can refresh after five seconds. No road images are sent by the default module. The previous frame-history and initial-pair descriptions below apply only to the retained `frameRuntime.ts` comparison path. The instructor knowledge and evidence/uncertainty standards still apply.


The active prompt is `server/coachingPrompt.ts`; the server adds its configured jurisdiction. This is prompt-based knowledge and authored few-shot scenarios. No model weights were trained, and the scenarios have not yet been reviewed by a qualified instructor.

## Teaching framework

Each result separates:

- `observations`: up to three concise visible facts.
- `uncertainties`: up to three facts not established by the frames/history.
- `coachingPoint`: why the specific situation matters.
- `shouldSpeak`, `message`, `reason`: one short spoken cue, or deliberate silence.
- `sceneChanged`: whether a discontinuity invalidates previous scene associations.

The server requires these fields and bounds all strings/lists. Generated speech with structured evidence requires at least one observation and a teaching point. Older minimal responses remain supported in client regression doubles; the production server requires the complete schema. Structured fields make claims inspectable, not verified ground truth.

The knowledge library covers junction controls and conditional turn-taking, visibility restrictions, following/space, cyclists alongside parked vehicles, pedestrian movement, lanes/merges, blocked exits, bends/side streets, large vehicles/work areas, and visible conditions. The teaching method prioritizes a specific object/location and a relevant attention or preparation cue. Generic lists of road users, speculation and repeated paraphrases should yield silence.

Ten fictional written scenarios demonstrate obscured pavement, cyclist space, a confirmed all-way stop, missing arrival history, unknown cross-street controls, observed pedestrian movement, queued junction exits, blind side streets, unchanged scenes and camera cuts. They teach an evidence/decision pattern; they are not labels for the current video and never schedule runtime messages.

## Memory and frame selection

- Retain at most about 20 seconds of sampled frames locally (up to 21 samples), at the existing one-second sampling cadence.
- Submit at most three images: an earlier anchor up to roughly ten seconds back, then the two latest frames. Initial short histories use the available two/three samples.
- Send at most four timestamped prior observation/uncertainty entries, all within 20 seconds. Memory is explicitly labelled prior MODEL OUTPUT, not independently verified facts.
- Sparse samples and memory do not establish continuous object tracking, a complete stop, intent or arrival order. “First visible” must never become “arrived first.” Unknown history stays unknown.
- A reported camera cut clears earlier associations and frame anchors; pause/seek/reset/end clears history and cancels work. Scene-change detection is model-based and still requires visual evaluation.
- One request remains in flight. Existing timeout, freshness, duplicate and speech queue protections still apply. More prompt context/output can increase latency; test it on longer footage.

## Jurisdiction

`COACHING_JURISDICTION` is an optional SERVER environment variable, e.g. `California`. It defaults to unknown. Do not set a region merely to unlock a desired answer: it must match the footage.

With unknown jurisdiction, the prompt focuses on visible interactions and transferable observation principles. California-specific turn-taking examples are conditional teaching references; the prompt must not assign vehicle priority from unconfirmed controls or missing chronology. It never provides a subsequent go signal or guarantees that a maneuver is safe.

The existing text filter still excludes obvious braking/acceleration, clearance, signal-color, speed-limit and collision-timing claims. These checks and prompt rules do not guarantee correctness.

## Reference sources

Reviewed during this change; the library is a selective paraphrase, not a full or authoritative legal handbook:

- [California DMV, Laws and Rules of the Road](https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/laws-and-rules-of-the-road/): conditional junction and yielding concepts.
- [California DMV, Safe Driving](https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/safe-driving/): observation, visibility and space management.
- [California DMV, Navigating the Roads](https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/navigating-the-roads/): lane, crossing and turning context.

Road rules depend on jurisdiction and situation; the app has no validated map/GPS context or comprehensive view of every approach. The supplied footage has not been established to be Californian.

## Try the current recording

Restart the dev server, open `/` without mocks, load the drive, enable replay sound and play. Expand **What the coach observed** to inspect observations, missing evidence and the teaching point. Judge whether the named object/location is visible, whether the cue is useful, whether uncertainty is preserved, and whether it arrives while still relevant. Silence can be correct.

No additional live provider calls were made for this prompt/memory change; the user will evaluate the existing example. Deterministic checks cover memory bounds, missing/future history, frame selection, schema validation, cancellation and the evidence UI. Instructor review, junction footage and a separate holdout remain needed before claiming junction-specific competence.

## Latency configuration

The first two samples are spaced about 250 ms apart (subject to actual video scheduling); subsequent sampling stays at one second. Sonnet 5.5 uses low effort and `between_tools` to avoid up-front thinking, and the static guide is marked for prompt caching. Cached input does not eliminate image processing or output generation, and the initial request may be a cache miss. Evidence fields are requested more concisely while retaining the full teaching library. Provider guidance: [Sonnet settings](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5), [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). A live replay still measured about 4.6 seconds of analysis; do not promise subsecond coaching.
