# Smoke checklist

Run on the demo laptop in Chrome before any merge to main.

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass
- [ ] `npm run e2e` passes (live Claude check is opt-in)
- [ ] Server has both API keys; neither appears in client assets or logs
- [ ] Setup discloses local video processing, Anthropic object-description requests, Cartesia text/held mic audio and no GPS upload
- [ ] Recorded video is actual media, not a Git LFS pointer
- [ ] Load drive, enable replay sound, play at 1x with no mocks
- [ ] Local boxes/CV counts update while Claude selects a message or deliberate silence from scene JSON
- [ ] Valid generated advice is spoken through Sonic and matches captions/timeline
- [ ] Data use lists image-free scene submissions and Cartesia requests without images, keys or tokens
- [ ] No overlapping analysis requests or audio; repeated suggestions are suppressed
- [ ] Pause/seek/end cancels old analysis and audio; late output never revives
- [ ] Seek clears timeline/data use and permits fresh advice
- [ ] Push-to-talk repeat replays the latest coaching; mute blocks later coaching; unmute restores it
- [ ] Network/model failure shows an error and produces no fabricated coaching
- [ ] Optional `?mapSpeech=1`: supplementary map cues work with validated GPS fixtures
- [ ] Longer primary recording and separate holdout reviewed without hiding errors or retuning the holdout
- [ ] Deployed HTTPS function and live mic/audio checked; demo rehearsed with honest latency/accuracy limits
