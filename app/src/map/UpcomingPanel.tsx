// Jeev's side-panel slot: the next three route features with distances, and the `reason` of the
// last cue, so judges can see why a cue fired. Distances come from the map module's snapshot;
// the last cue comes from the bus, so the panel also works with `?mock=map`.
import { useSyncExternalStore } from 'react';
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';
import { featureLabel } from './cues.ts';
import type { EngineStatus } from './engine.ts';
import { mapState } from './mapState.ts';

const STATUS_NOTES: Partial<Record<EngineStatus, string>> = {
  waiting: 'Waiting for the first position.',
  noPosition: 'No location available right now.',
  noRoute: 'No route loaded.',
  offRoute: 'Position is off the planned route. Cues paused.',
  backward: 'GPS jumped backward. Cues paused.',
  jump: 'GPS jumped ahead. Cues paused.',
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function UpcomingPanel({ ctx }: PanelProps) {
  const snapshot = useSyncExternalStore(mapState.subscribe, mapState.get);
  const last = useEvents(ctx.bus, 'mapCue').at(-1);

  const note =
    snapshot.status === 'lowAccuracy'
      ? `GPS accuracy ${Math.round(snapshot.accuracyM ?? 0)} m. Cues paused.`
      : STATUS_NOTES[snapshot.status];

  return (
    <section className="panel">
      <h2>Upcoming</h2>
      {note && <p>{note}</p>}
      {snapshot.upcoming.length > 0 ? (
        <ol>
          {snapshot.upcoming.map((f) => (
            <li key={f.id}>
              {capitalize(featureLabel(f))}: {Math.round(f.distM)} m
              {f.source === 'curated' && ' (curated)'}
            </li>
          ))}
        </ol>
      ) : (
        snapshot.progressM !== undefined && <p>No more route features ahead.</p>
      )}
      <p>{last ? `Last cue: ${last.reason}` : 'No cue yet.'}</p>
    </section>
  );
}
