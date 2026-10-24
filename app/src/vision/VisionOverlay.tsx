import { useSyncExternalStore } from 'react';
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';
import { coachingStore } from './coachingStore.ts';
const LABELS = {
  idle: 'Video coach ready. Play the recording to begin.',
  loadingCv: 'Loading local object detector…',
  watching: 'Local CV is watching. Claude responds to scene changes.',
  collecting: 'Collecting recent video frames…',
  analyzing: 'Local CV is watching · Claude is selecting coaching…',
  ready: 'Video analysis complete',
  error: 'Video analysis unavailable',
};
export function VisionOverlay({ ctx }: PanelProps) {
  const lastAdvice = useEvents(ctx.bus, 'visionAdvice').at(-1);
  const simulated = lastAdvice?.id.startsWith('mock-') ? lastAdvice : undefined;
  const snapshot = useSyncExternalStore(coachingStore.subscribe, coachingStore.get);
  return (
    <div className="overlay">
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
      <div className="overlay-note" role="status">
        <strong>
          {simulated?.id.startsWith('mock-') ? 'Simulated video coaching' : LABELS[snapshot.status]}
        </strong>
        {snapshot.cvScene && (
          <p>
            Local CV: {snapshot.cvScene.objects.length} stable objects · {snapshot.cvFrames} frames
            processed · {Math.round(snapshot.cvLatencyMs ?? 0)} ms/frame
          </p>
        )}
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
        {snapshot.diagnostics && snapshot.diagnostics.length > 0 && (
          <details className="coaching-evidence">
            <summary>Coaching request diagnostics ({snapshot.diagnostics.length})</summary>
            <p>
              Local record; retained after playback ends. Copy this JSON to diagnose missing advice.
            </p>
            <pre style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(snapshot.diagnostics, null, 2)}
            </pre>
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
