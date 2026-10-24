// Pure state for the Timeline panel: one row per cue or alert, with why it fired, every arbiter
// decision about it, and the measured first-audible latency of each time it was spoken.
// Everything is keyed by id, so the result does not depend on the order nested bus events arrive.
import type {
  ArbiterDecision,
  Events,
  MapFeatureKind,
  WebcamAlert,
} from '../../../shared/types.ts';

export type TimelineEvent = {
  [
    K in
      | 'visionAdvice'
      | 'mapCue'
      | 'webcamAlert'
      | 'speak'
      | 'arbiterDecision'
      | 'speechStarted'
      | 'tripReset'
  ]: {
    type: K;
    payload: Events[K];
  };
}[
  | 'visionAdvice'
  | 'mapCue'
  | 'webcamAlert'
  | 'speak'
  | 'arbiterDecision'
  | 'speechStarted'
  | 'tripReset'];

export type TimelineState = {
  sources: Readonly<Record<string, { label: string; why: string }>>;
  texts: Readonly<Record<string, string>>; // sourceId -> spoken text, for sources with no cue
  decisions: readonly ArbiterDecision[];
  firstAudibleMs: Readonly<Record<string, number>>; // speakId -> ms
};

export type TimelineStep = ArbiterDecision & { firstAudibleMs?: number };
export type TimelineRow = { sourceId: string; label: string; why?: string; steps: TimelineStep[] };

export const emptyTimeline: TimelineState = {
  sources: {},
  texts: {},
  decisions: [],
  firstAudibleMs: {},
};

const FEATURE_LABELS: Record<MapFeatureKind, string> = {
  turnLeft: 'Left turn',
  turnRight: 'Right turn',
  stopSign: 'Stop sign',
  crosswalk: 'Crosswalk',
  signal: 'Traffic light',
};

const ALERT_LABELS: Record<WebcamAlert['kind'], string> = {
  pedestrianNearby: 'Pedestrian',
  followingDistance: 'Following distance',
};

// Rows with no cue or alert behind them: the arbiter's own sources.
const OTHER_LABELS: Record<string, string> = { repeat: 'Repeat request' };

export function timelineReducer(state: TimelineState, event: TimelineEvent): TimelineState {
  switch (event.type) {
    case 'tripReset':
      return emptyTimeline;
    case 'mapCue': {
      const { id, featureKind, reason } = event.payload;
      const source = { label: FEATURE_LABELS[featureKind], why: reason };
      return { ...state, sources: { ...state.sources, [id]: source } };
    }
    case 'visionAdvice': {
      const { id, reason } = event.payload;
      return {
        ...state,
        sources: { ...state.sources, [id]: { label: 'Video coaching', why: reason } },
      };
    }
    case 'webcamAlert': {
      const { id, kind, reason } = event.payload;
      const source = { label: ALERT_LABELS[kind], why: reason };
      return { ...state, sources: { ...state.sources, [id]: source } };
    }
    case 'speak':
      return { ...state, texts: { ...state.texts, [event.payload.sourceId]: event.payload.text } };
    case 'arbiterDecision':
      return { ...state, decisions: [...state.decisions, event.payload] };
    case 'speechStarted': {
      const { id, firstAudibleMs } = event.payload;
      return { ...state, firstAudibleMs: { ...state.firstAudibleMs, [id]: firstAudibleMs } };
    }
  }
}

export function timelineRows(state: TimelineState): TimelineRow[] {
  const rows = new Map<string, TimelineRow>();
  for (const decision of state.decisions) {
    let row = rows.get(decision.sourceId);
    if (!row) {
      const source = state.sources[decision.sourceId];
      row = {
        sourceId: decision.sourceId,
        label:
          source?.label ??
          OTHER_LABELS[decision.sourceId] ??
          state.texts[decision.sourceId] ??
          decision.sourceId,
        why: source?.why,
        steps: [],
      };
      rows.set(decision.sourceId, row);
    }
    const ms = decision.speakId ? state.firstAudibleMs[decision.speakId] : undefined;
    row.steps.push(
      decision.action === 'spoken' && ms !== undefined
        ? { ...decision, firstAudibleMs: ms }
        : decision,
    );
  }
  return [...rows.values()];
}
