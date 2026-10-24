# Smoke checklist

Run on the demo laptop in Chrome before every merge to `main`. Rohit keeps this list current.

- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass
- [ ] Setup screen: Start stays disabled until the supervisor box is ticked
- [ ] 1x replay: a route cue is spoken and captioned, and the Upcoming panel shows its reason
- [ ] A pedestrian alert interrupts the current reminder with no overlapping audio
- [ ] Push-to-talk "repeat that" re-speaks the last route cue
- [ ] Timeline shows spoken, interrupted and dropped rows; latency badge shows a measured number
- [ ] Data-use panel lists each Cartesia request
- [ ] Seek back: cues fire once more, with no stale queue or cooldown
- [ ] With wifi off, the pedestrian clip still plays
- [ ] No console errors
