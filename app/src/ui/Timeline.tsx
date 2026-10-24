// One row per `arbiterDecision`: what was spoken, interrupted or dropped, why, and (when
// spoken) how fast audio started, joined from `speak` and `speechStarted`.
import { useEvents } from '../../../shared/useEvents.ts';
import type { Bus } from '../../../shared/types.ts';

export function Timeline({ bus }: { bus: Bus }) {
  const decisions = useEvents(bus, 'arbiterDecision');
  const speaks = useEvents(bus, 'speak');
  const started = useEvents(bus, 'speechStarted');

  const latencyFor = (sourceId: string) => {
    const speakId = speaks.find((s) => s.sourceId === sourceId)?.id;
    return started.find((s) => s.id === speakId)?.firstAudibleMs;
  };

  return (
    <section className="timeline">
      <h2>Timeline</h2>
      <ol>
        {decisions.map((d, i) => {
          const ms = d.action === 'spoken' ? latencyFor(d.sourceId) : undefined;
          return (
            <li key={i}>
              {(d.tripMs / 1000).toFixed(1)}s {d.sourceId}: {d.action} ({d.reason})
              {ms !== undefined && ` - first audible ${Math.round(ms)} ms`}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
