# Map module notes (Jeev)

How the route, track and cue pieces work, how to make the real drive fixtures, and the
conventions other owners can rely on. Plan: `docs/DESIGN.md`, "Jeev: route, map cues and drive
fixtures".

## What the module emits

- `position` about every 100 ms of trip time (10 Hz at 1x), interpolated from `track.json` at
  `ctx.clock.nowMs()`. Nothing while paused (the clock stands still), and nothing outside the
  recorded track span: there is no fix there and we do not dead-reckon. `accuracyM` is the worse of
  the two surrounding fixes.
- `mapCue` once per feature per trip, when the time to arrival enters the feature's window. Never
  emitted inside `start()` or inside the reset callback, and never on the first update after a
  reset, so nothing is said at load or after a seek while paused.
- Cue ids are `cue-<featureId>-<pass>-<tripMs>`, where `pass` counts resets. A cue replayed after a
  seek back gets a new id. `featureId` stays the same.
- `earliestMs` is the emission time. `expiresMs` is the earlier of "drop after" and the last start
  that still finishes speaking (14 chars/s) before the estimated arrival.

On `tripReset` the module clears route progress, fired feature ids and the panel snapshot.

## Cue rules (current values)

| Feature | Window (time to arrival) | Drop after | Priority |
| --- | --- | --- | --- |
| Left turn | 9-6 s | 3 s | 1 |
| Right turn | 8-5 s | 3 s | 1 |
| Stop sign | 9-6 s | 3 s | 1 |
| Crosswalk | 7-5 s | 2 s | 2 |
| Traffic light | 8-5 s | 3 s | 2 |

These are the design doc's starting values, set in `cues.ts` (`CUE_RULES`). Time to arrival =
remaining route distance / max(speed, 2 m/s). If a line takes longer to say than the window
allows, the window opens early enough to finish 1 s before the feature. A turn without a street
name gets no cue: the approved phrase needs one. Tune these on the real drive and update this table.

## Route progress and GPS quality

Each position is projected onto the route line (`progress.ts`). Progress only moves forward. No
cue decision is made while any of these holds:

- `accuracyM` is over 25 m (`lowAccuracy`)
- the position is over 40 m from the route (`offRoute`)
- the match jumps backward more than 5 m (`backward`). After 5 s of this the module matches the
  route afresh.
- the match jumps further forward than 30 m + 2 x speed x elapsed time (`jump`)

On a route that uses the same street twice, the pass is picked by continuity (or, right after a
reset, by the distance driven so far on the track). The Upcoming panel shows the current status.

## Making the real fixtures

1. **Track.** Export the GPX from the logger, then run one of:

   ```sh
   npm run track -- drive.gpx --video-start 2026-10-24T18:03:12.400Z
   npm run track -- drive.gpx --clap-video-s 2.4 --clap-utc 2026-10-24T18:03:14.800Z
   npm run track -- drive.gpx --offset-ms -4200
   ```

   `syncOffsetMs` = first GPS fix time - video start time, and `tMs` = fix time - first fix time +
   `syncOffsetMs`. The runtime uses `tMs` as is. For the video start, the iPhone file's creation
   time is a good first guess (`ffprobe -v quiet -show_entries format_tags=creation_time video.mp4`).
   Then refine against the landmarks (step 3) and re-run with `--offset-ms`. iOS `-1` speed,
   course or accuracy values count as unknown. Speed and heading are derived where missing.
   Accuracy comes from an accuracy element, or HDOP x 5 m if that is all the GPX has. A GPX with
   neither cannot use the 25 m gate; the script warns about this.

2. **Route and features.**

   ```sh
   npm run route -- --from-track 12        # waypoints sampled along track.json
   npm run route -- --waypoints "lat,lon;lat,lon;..."
   ```

   This calls OSRM (driving route with steps) and Overpass, once, at build time. The app never
   calls them. The script prints every feature with its distance, plus warnings. Read them, and
   check each flagged node on openstreetmap.org. It also reports how far the route strays from the
   recorded track. If it strays, add waypoints where they differ.

   A node counts as on our path only if it lies within 5 m of the route line and one of its OSM ways
   runs along our direction of travel there. This drops stop signs and crossings that belong to
   cross streets. `direction=forward|backward` tags are checked against that way. We do not use
   OSRM's node-id annotations: the public server reports wrong ids for newer OSM nodes. Same-kind
   features within 30 m are merged (for example both sides of one crosswalk). Turns come from OSRM
   steps (`turn`, `end of road`, `continue` with left/right or sharp left/right).

3. **Hand fixes** go in `scripts/route/curated.json`, never straight into `features.json`, so
   re-running the script keeps them:

   ```json
   {
     "remove": ["stopSign-123456"],
     "add": [
       { "id": "curated-stop-1", "kind": "stopSign", "lat": 37.87, "lon": -122.27,
         "note": "Stop sign present on site, missing in OSM", "nearRouteDistM": 640 }
     ]
   }
   ```

   Every addition needs a `note` and is written as `source: "curated"`. Its cue reason says
   "curated map data", and the panel marks it, so we can say so if asked. `nearRouteDistM` is only
   needed when the route passes the spot twice. To give an unnamed turn a street, remove it and add
   a curated turn with `street`.

4. **Annotations** (`fixtures/demo-drive/annotations.json`). Tests read this file; the app never
   loads it.
   - `landmarks`: `{ tripMs, label }` where `label` is a **feature id** and `tripMs` is when the
     video shows the car at that feature. The track-sync test checks that the position passes
     closest to it within 1 s. Add at least two, far apart in the drive.
   - `expected`: `{ tripMs, kind }`. For map kinds (`turnLeft`, `stopSign`, ...), `tripMs` is when
     the car reaches the feature in the video, and the test checks that a cue of that kind fires in
     the 12 s before it. Tejas's pedestrian entries use other kinds and are ignored here.

5. Run `npm test`. `fixtures.test.ts` replays the real fixtures at 1x and checks the following:
   every feature the car passes is cued exactly once, before arrival; features sit on the route
   where `routeDistM` says; curated features have notes; turns have street names; and the
   annotation checks above.

## Files

| File | What |
| --- | --- |
| `index.ts` | the `AppModule`: animation-frame loop, bus emits, reset handling |
| `engine.ts` | all decisions for one trip time, no browser or bus (unit-tested) |
| `track.ts` | GPS fix cleanup and interpolation (shared with `scripts/track`) |
| `geo.ts` | distances, bearings, route projection (shared with both scripts) |
| `progress.ts` | route progress and GPS-quality gating |
| `cues.ts` | cue windows and the approved phrases, word for word |
| `mapState.ts` | latest snapshot for `UpcomingPanel` (it mounts after `start()`) |
| `UpcomingPanel.tsx` | next three features with distances, last cue's reason, match status |
| `testing.ts` | synthetic drive for tests only |
