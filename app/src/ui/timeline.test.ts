import { describe, expect, it } from 'vitest';
import {
  emptyTimeline,
  timelineReducer,
  timelineRows,
  type TimelineEvent,
  type TimelineState,
} from './timeline.ts';

const run = (events: TimelineEvent[], from: TimelineState = emptyTimeline) =>
  events.reduce(timelineReducer, from);

const cue: TimelineEvent = {
  type: 'mapCue',
  payload: {
    id: 'cue-1',
    featureId: 'stop-1',
    featureKind: 'stopSign',
    text: 'Stop sign ahead. Prepare for a complete stop.',
    reason: 'stop sign 74 m ahead at 9 m/s',
    priority: 1,
    earliestMs: 3000,
    expiresMs: 6000,
  },
};

const spoken = (speakId: string, tripMs: number, reason = 'cue window open'): TimelineEvent => ({
  type: 'arbiterDecision',
  payload: { sourceId: 'cue-1', action: 'spoken', reason, tripMs, speakId },
});

describe('timeline', () => {
  it('groups decisions per source with the cue reason and per-speak latency', () => {
    const state = run([
      cue,
      spoken('cue-1#1', 3000),
      { type: 'speechStarted', payload: { id: 'cue-1#1', firstAudibleMs: 240 } },
      {
        type: 'arbiterDecision',
        payload: {
          sourceId: 'cue-1',
          action: 'interrupted',
          reason: 'preempted by alert',
          tripMs: 4000,
          speakId: 'cue-1#1',
        },
      },
      spoken('cue-1#3', 6000, 'replay after interrupt'),
      { type: 'speechStarted', payload: { id: 'cue-1#3', firstAudibleMs: 310 } },
    ]);
    const [row] = timelineRows(state);
    expect(row?.label).toBe('Stop sign');
    expect(row?.why).toBe('stop sign 74 m ahead at 9 m/s');
    expect(row?.steps.map((s) => [s.action, s.firstAudibleMs])).toEqual([
      ['spoken', 240],
      ['interrupted', undefined],
      ['spoken', 310],
    ]);
  });

  it('joins latency even when speechStarted arrives before the decision', () => {
    const state = run([
      { type: 'speechStarted', payload: { id: 'cue-1#1', firstAudibleMs: 200 } },
      cue,
      spoken('cue-1#1', 3000),
    ]);
    expect(timelineRows(state)[0]?.steps[0]?.firstAudibleMs).toBe(200);
  });

  it('labels alerts, arbiter-only sources and repeat requests', () => {
    const state = run([
      {
        type: 'webcamAlert',
        payload: {
          id: 'a1',
          kind: 'pedestrianNearby',
          text: 'Pedestrian ahead. Stay alert.',
          reason: 'person, conf 0.81',
          confidence: 0.81,
          tripMs: 0,
          expiresMs: 1500,
          clipKey: 'pedestrian',
        },
      },
      {
        type: 'arbiterDecision',
        payload: { sourceId: 'a1', action: 'spoken', reason: 'vision alert', tripMs: 0 },
      },
      {
        type: 'speak',
        payload: {
          id: 'camera-paused#2',
          sourceId: 'camera-paused',
          text: 'Camera paused. Route reminders only.',
          priority: 1,
        },
      },
      {
        type: 'arbiterDecision',
        payload: {
          sourceId: 'camera-paused',
          action: 'spoken',
          reason: 'camera health down',
          tripMs: 1,
        },
      },
      {
        type: 'arbiterDecision',
        payload: { sourceId: 'repeat', action: 'dropped', reason: 'nothing to repeat', tripMs: 2 },
      },
    ]);
    expect(timelineRows(state).map((r) => [r.label, r.why])).toEqual([
      ['Pedestrian', 'person, conf 0.81'],
      ['Camera paused. Route reminders only.', undefined],
      ['Repeat request', undefined],
    ]);
  });

  it('clears on tripReset', () => {
    const state = run([
      cue,
      spoken('cue-1#1', 3000),
      { type: 'tripReset', payload: { tripMs: 0 } },
    ]);
    expect(timelineRows(state)).toEqual([]);
  });
});
