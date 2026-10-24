# Holdout check (Tejas)

Acceptance test "Holdout clip" (docs/DESIGN.md): run a second short clip the thresholds were
**not** tuned on, with no retuning, and write down what the detector missed and any false alerts.
We report these honestly if asked. Do not change `config.ts` to make this clip pass — that would
defeat the point.

## How to run

1. Put the holdout clip at `fixtures/demo-drive/video.mp4` (or temporarily point the video `src`
   at it) and open the app in Chrome on the demo laptop. Leave every number in `config.ts` as it
   was tuned on the primary demo clip.
2. Watch the whole clip once at 1×. Use the overlay (boxes, forward region, red alert highlight)
   and the browser console `[vision] alert ...` lines to see exactly when and why alerts fired.
3. Record every pedestrian/vehicle event below.

## Config under test

Fill in the values from `config.ts` at the time of the run so the result is reproducible.

- Model: EfficientDet-Lite0 (float16), detector score floor: `SCORE_THRESHOLD` = ____
- Pedestrian: conf ≥ `PED_MIN_CONF` = ____, `PED_FRAMES_REQUIRED`/`PED_FRAMES_WINDOW` = __ / __
- Forward region (`FORWARD_REGION`): ____
- Following-distance fallback enabled? `ENABLE_FOLLOWING_DISTANCE` = ____

## Results

| Clip time | What was in frame | Alert fired? | Correct? | Notes |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

### Misses (a real forward pedestrian/too-close vehicle that raised no alert)

- _none recorded yet_

### False alerts (an alert with no matching real hazard)

- _none recorded yet_

## Summary

- Pedestrian alerts: __ correct, __ missed, __ false.
- One-paragraph honest read of how the thresholds generalized to unseen footage: ____
