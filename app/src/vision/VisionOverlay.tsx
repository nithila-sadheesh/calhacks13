import { useSyncExternalStore } from 'react';
import { coachingStore } from './coachingStore.ts';

// Local CV boxes only; coaching text is spoken and captioned below the video, not drawn over it.
export function VisionOverlay() {
  const snapshot = useSyncExternalStore(coachingStore.subscribe, coachingStore.get);
  return (
    <div className="overlay" aria-hidden="true">
      {snapshot.cvTracks?.map((track) => (
        <div
          key={track.id}
          className="cv-box"
          style={{
            left: `${track.box.x * 100}%`,
            top: `${track.box.y * 100}%`,
            width: `${track.box.w * 100}%`,
            height: `${track.box.h * 100}%`,
          }}
        >
          <span>
            {track.cls} {Math.round(track.score * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}
