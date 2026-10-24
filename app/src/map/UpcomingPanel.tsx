// Jeev's side-panel slot (STUB). Will show the next three features with distances and the
// `reason` of the last cue, so judges can see why a cue fired.
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';

export function UpcomingPanel({ ctx }: PanelProps) {
  const cues = useEvents(ctx.bus, 'mapCue');
  const last = cues.at(-1);
  return (
    <section className="panel">
      <h2>Upcoming</h2>
      <p>{last ? `Last cue: ${last.reason}` : 'No cue yet.'}</p>
    </section>
  );
}
