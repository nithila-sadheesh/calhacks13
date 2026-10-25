// A calm strip over the camera: "● Live" on the left, and on the right either a vision warning
// (while one is active) or the next route feature. Reads the map module's snapshot the same way
// UpcomingPanel does. No speed or distance — kept sparse on purpose.
import { useSyncExternalStore } from 'react';
import { featureLabel } from '../map/cues.ts';
import { mapState } from '../map/mapState.ts';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function StatusStrip({ live, warning }: { live: boolean; warning: string | null }) {
  const snapshot = useSyncExternalStore(mapState.subscribe, mapState.get);
  const next = snapshot.upcoming[0];
  const nextLabel = next ? capitalize(featureLabel(next)) : null;

  return (
    <div className="status-strip">
      <span className="status-chip">
        <span className="live-dot" />
        {live ? 'Live' : 'Replay'}
      </span>
      {warning ? (
        <span className="status-chip is-warning">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 2 20h20L12 3Z" />
            <path d="M12 10v4M12 17.5v.01" />
          </svg>
          {warning}
        </span>
      ) : nextLabel ? (
        <span className="status-chip">{nextLabel}</span>
      ) : null}
    </div>
  );
}
