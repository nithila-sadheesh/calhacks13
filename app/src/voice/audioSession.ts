// WebKit's audio session (Safari 16.4+, every iOS browser). 'playback' keeps speech audible with
// the ring/silent switch on, but WebKit refuses microphone capture under it ("AudioSession
// category is not compatible with audio capture"), so capture switches to 'play-and-record' and
// restores the previous type when the microphone closes. Browsers without the API are untouched.

type AudioSessionType = 'auto' | 'playback' | 'play-and-record' | (string & {});
type SessionHolder = { audioSession?: { type: AudioSessionType } };

function session(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator) {
  return (nav as SessionHolder | undefined)?.audioSession;
}

export function enterPlaybackSession(nav?: unknown): void {
  const s = session(nav);
  if (s) s.type = 'playback';
}

// Returns the function that restores the previous type.
export function enterCaptureSession(nav?: unknown): () => void {
  const s = session(nav);
  if (!s || s.type === 'play-and-record') return () => {};
  const previous = s.type;
  s.type = 'play-and-record';
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (s.type === 'play-and-record') s.type = previous;
  };
}
