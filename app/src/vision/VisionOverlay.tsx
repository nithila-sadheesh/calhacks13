import { useSyncExternalStore } from 'react';
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';
import { coachingStore } from './coachingStore.ts';
const LABELS = {
  idle: 'Video coach ready. Play the recording to begin.',
  collecting: 'Collecting recent video frames…',
  analyzing: 'Analyzing the video with Claude…',
  ready: 'Video analysis complete',
  error: 'Video analysis unavailable',
};
export function VisionOverlay({ ctx }: PanelProps) {
  const lastAdvice = useEvents(ctx.bus, 'visionAdvice').at(-1);
  const simulated = lastAdvice?.id.startsWith('mock-') ? lastAdvice : undefined;
  const snapshot = useSyncExternalStore(coachingStore.subscribe, coachingStore.get);
  return (
    <div className="overlay">
      <div className="overlay-note" role="status">
        <strong>
          {simulated?.id.startsWith('mock-') ? 'Simulated video coaching' : LABELS[snapshot.status]}
        </strong>
        {(snapshot.message ?? simulated?.text) && <p>{snapshot.message ?? simulated?.text}</p>}
        {snapshot.reason && <p>{snapshot.reason}</p>}
        {snapshot.observations && (
          <details className="coaching-evidence">
            <summary>What the coach observed</summary>
            <ul>
              {snapshot.observations.map((observation, index) => (
                <li key={index}>{observation}</li>
              ))}
            </ul>
            {snapshot.uncertainties && snapshot.uncertainties.length > 0 && (
              <>
                <strong>Not established</strong>
                <ul>
                  {snapshot.uncertainties.map((uncertainty, index) => (
                    <li key={index}>{uncertainty}</li>
                  ))}
                </ul>
              </>
            )}
            {snapshot.coachingPoint && <p>Teaching point: {snapshot.coachingPoint}</p>}
          </details>
        )}
        {snapshot.error && <p>{snapshot.error}</p>}
        {snapshot.latencyMs !== undefined && (
          <small>
            Analysis: {(snapshot.latencyMs / 1000).toFixed(1)} s · frames through{' '}
            {((snapshot.frameTripMs ?? 0) / 1000).toFixed(1)} s
          </small>
        )}
      </div>
    </div>
  );
}
