// Nithila's side-panel slot (STUB). Will hold the push-to-talk button, the first-audible latency
// badge and the mute control.
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';

export function VoicePanel({ ctx }: PanelProps) {
  const started = useEvents(ctx.bus, 'speechStarted');
  const last = started.at(-1);
  return (
    <section className="panel">
      <h2>Voice</h2>
      <p>{last ? `First audible: ${Math.round(last.firstAudibleMs)} ms` : 'Nothing spoken yet.'}</p>
    </section>
  );
}
