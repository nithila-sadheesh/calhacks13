// Why each cue fired and what happened to it: one row per cue or alert with its reason, every
// arbiter decision (spoken, interrupted, queued, dropped, coalesced) and first-audible latency.
import { useEffect, useReducer, useRef } from 'react';
import type { Bus } from '../../../shared/types.ts';
import { emptyTimeline, timelineReducer, timelineRows, type TimelineStep } from './timeline.ts';

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function useTimeline(bus: Bus) {
  const [state, dispatch] = useReducer(timelineReducer, emptyTimeline);
  useEffect(() => {
    const offs = [
      bus.on('visionAdvice', (payload) => dispatch({ type: 'visionAdvice', payload })),
      bus.on('mapCue', (payload) => dispatch({ type: 'mapCue', payload })),
      bus.on('webcamAlert', (payload) => dispatch({ type: 'webcamAlert', payload })),
      bus.on('speak', (payload) => dispatch({ type: 'speak', payload })),
      bus.on('arbiterDecision', (payload) => dispatch({ type: 'arbiterDecision', payload })),
      bus.on('speechStarted', (payload) => dispatch({ type: 'speechStarted', payload })),
      bus.on('tripReset', (payload) => dispatch({ type: 'tripReset', payload })),
    ];
    return () => offs.forEach((off) => off());
  }, [bus]);
  return timelineRows(state);
}

function Step({ step }: { step: TimelineStep }) {
  return (
    <li className={`step step-${step.action}`}>
      <span className="step-action">{step.action}</span>
      <span className="step-detail">
        {formatSeconds(step.tripMs)} · {step.reason}
        {step.firstAudibleMs !== undefined &&
          ` · first audible ${Math.round(step.firstAudibleMs)} ms`}
      </span>
    </li>
  );
}

export function Timeline({ bus }: { bus: Bus }) {
  const rows = useTimeline(bus);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [rows.length]);

  return (
    <section className="timeline panel" aria-label="Timeline">
      <h2>Timeline</h2>
      {rows.length === 0 ? (
        <p className="muted">Nothing yet. Rows appear as cues and alerts reach the arbiter.</p>
      ) : (
        <ol ref={listRef} className="timeline-rows">
          {rows.map((row) => (
            <li key={row.sourceId} className="timeline-row">
              <div className="timeline-what">
                <span className="timeline-time">{formatSeconds(row.steps[0]?.tripMs ?? 0)}</span>
                <strong>{row.label}</strong>
                {row.why && <span className="muted">{row.why}</span>}
              </div>
              <ol className="steps">
                {row.steps.map((step, i) => (
                  <Step key={i} step={step} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
