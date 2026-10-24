# Smoke checklist

Run on the demo laptop in Chrome before every merge to `main`. Rohit keeps this list current.

Automated first:

- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass
- [ ] `npm run e2e` passes (setup check, captions, timeline, data use, seek reset, pause, 1x lock)

By hand, with the real modules (drop a module from `?mock=` once it passes its owner's checks):

- [ ] Setup screen: Load stays disabled until the supervisor box is ticked; privacy statement is shown
- [ ] 1x replay: a route cue is spoken and captioned, and the Upcoming panel shows its reason
- [ ] A pedestrian alert interrupts the current reminder with no overlapping audio; the caption turns red-edged
- [ ] Timeline shows spoken, interrupted and dropped rows with reasons; latency badge shows a measured number
- [ ] Push-to-talk "repeat that" re-speaks the last route cue (timeline: "repeat requested")
- [ ] Say "mute": reminders stop, a pedestrian warning still plays; "unmute" restores reminders
- [ ] Camera down (vision stalled 2 s): "Camera paused. Route reminders only." plays once
- [ ] Pause: trip time freezes and nothing new starts; resume continues
- [ ] Seek back: timeline and data use clear, then cues fire once more, with no stale queue or cooldown
- [ ] The speed menu is not offered and playback stays at 1x
- [ ] Data-use panel lists each Cartesia request
- [ ] With wifi off, the pedestrian clip still plays
- [ ] No console errors
