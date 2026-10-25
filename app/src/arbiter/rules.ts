import { parseDelivery } from '../../../shared/delivery.ts';
// The arbiter's rules as one pure function: step(state, input, nowMs) returns the next state and
// the events to emit. No bus, no clock, no timers, so every rule in docs/DESIGN.md is unit-tested
// in rules.test.ts. The arbiter decides only when something is heard, never what is safe.
import { validCoachingText } from '../../../shared/coaching.ts';
import type {
  ArbiterDecision,
  AssistantReply,
  CueWording,
  Delivery,
  MapCue,
  MapFeatureKind,
  SpeakRequest,
  WebcamAlert,
  VisionAdvice,
} from '../../../shared/types.ts';

export const PROACTIVE_GAP_MS = 6000;
export const CONVERSATION_QUIET_MS = 8000;
export const SPACING_MS = 4000; // gap after any line before a fresh route cue or advisory
export const REPLAY_GAP_MS = 1000; // shorter gap before an interrupted cue's replay or a repeat
export const ALERT_COOLDOWN_MS = 8000; // per alert kind
export const REPEAT_TTL_MS = 10000;
export const ANSWER_TTL_MS = 15000; // a spoken answer older than this is no longer an answer
export const SYSTEM_TTL_MS = 10000;
export const WATCHDOG_SLACK_MS = 8000; // on top of the estimated speech length
const CHARS_PER_SECOND = 14;
const SLOWER_PACE_FACTOR = 1.25; // a 'slower' line takes longer; Sonic treats speed as guidance

export const NOTHING_TO_REPEAT = 'Nothing to repeat yet.';

export const CAMERA_PAUSED = {
  sourceId: 'camera-paused',
  text: 'Camera paused. Route reminders only.',
  clipKey: 'cameraPaused',
};

const FALLBACK_CLIPS: Partial<Record<MapFeatureKind, string>> = {
  turnLeft: 'turn',
  turnRight: 'turn',
  stopSign: 'stopSign',
  crosswalk: 'crosswalk',
};

export type Item = {
  origin: 'cue' | 'alert' | 'repeat' | 'system' | 'answer' | 'vision';
  generated?: boolean;
  sourceId: string;
  dedupeKey?: string; // never spoken twice per trip; repeats and replays bypass it
  alertKind?: WebcamAlert['kind'];
  text: string;
  clipKey?: string;
  fallbackClipKey?: string;
  delivery?: Delivery;
  priority: 0 | 1 | 2;
  earliestMs: number;
  expiresMs: number;
  gapMs: number; // required silence since the last line ended; 0 for alerts
  why: string; // reason logged when it is spoken
  replayed: boolean;
};

export type ArbiterState = {
  queue: readonly Item[];
  current?: { item: Item; speakId: string; startedMs: number };
  spokenKeys: ReadonlySet<string>;
  lastAlertMs: Readonly<Partial<Record<WebcamAlert['kind'], number>>>;
  // The last line that "repeat" can replay: a route reminder, an answer or a system line. Never a
  // vision warning: replayed late, "pedestrian ahead" would describe a moment that has passed.
  lastLine?: Item;
  cueWording: ReadonlyMap<string, CueWording>; // by featureId; used if it arrived in time
  lastEndMs?: number;
  muted: boolean;
  cameraPausedSaid: boolean;
  playing: boolean;
  inputActive: boolean;
  pendingQueryId?: string;
  lastProactiveMs?: number;
  quietUntilMs: number;
  seq: number; // never reset, so speak ids stay unique across seeks
};

export type Input =
  | { type: 'cue'; cue: MapCue }
  | { type: 'alert'; alert: WebcamAlert }
  | { type: 'advice'; advice: VisionAdvice }
  | { type: 'speechEnded'; id: string }
  | { type: 'voice'; kind: 'repeat' | 'mute' | 'unmute' }
  | { type: 'answer'; reply: AssistantReply }
  | { type: 'voiceActivity'; active: boolean }
  | { type: 'query'; id: string }
  | { type: 'cueWording'; wording: CueWording }
  | { type: 'camera'; ok: boolean }
  | { type: 'tripState'; state: 'idle' | 'playing' | 'paused' | 'ended' }
  | { type: 'tick' }
  | { type: 'reset' };

export type Effect =
  | { type: 'speak'; request: SpeakRequest }
  | { type: 'decision'; decision: ArbiterDecision }
  | { type: 'log'; message: string; data?: unknown };

export function initialState(playing = false, seq = 0): ArbiterState {
  return {
    queue: [],
    spokenKeys: new Set(),
    lastAlertMs: {},
    cueWording: new Map(),
    muted: false,
    cameraPausedSaid: false,
    playing,
    inputActive: false,
    quietUntilMs: 0,
    seq,
  };
}

// `wording` is Claude's text for this feature, if it arrived before the cue; otherwise the
// map's approved template is spoken in the default voice. The fallback clip is the same either way.
export function cueItem(cue: MapCue, wording?: CueWording): Item {
  const item: Item = {
    origin: 'cue',
    sourceId: cue.id,
    dedupeKey: `feature:${cue.featureId}`,
    text: wording?.text ?? cue.text,
    fallbackClipKey: FALLBACK_CLIPS[cue.featureKind],
    priority: cue.priority,
    earliestMs: cue.earliestMs,
    expiresMs: cue.expiresMs,
    gapMs: SPACING_MS,
    why: wording ? 'cue window open (Claude wording)' : 'cue window open',
    replayed: false,
  };
  if (wording?.delivery) item.delivery = wording.delivery;
  return item;
}

export function alertItem(alert: WebcamAlert): Item {
  return {
    origin: 'alert',
    sourceId: alert.id,
    dedupeKey: `alert:${alert.id}`,
    alertKind: alert.kind,
    text: alert.text,
    clipKey: alert.clipKey,
    priority: 0,
    earliestMs: alert.tripMs,
    expiresMs: alert.expiresMs,
    gapMs: 0,
    why: 'vision alert',
    replayed: false,
  };
}

type Draft = {
  -readonly [K in keyof ArbiterState]: ArbiterState[K];
} & { queue: Item[]; spokenKeys: Set<string>; lastAlertMs: ArbiterState['lastAlertMs'] };

type Run = { s: Draft; nowMs: number; effects: Effect[] };

export function step(
  state: ArbiterState,
  input: Input,
  nowMs: number,
): { state: ArbiterState; effects: Effect[] } {
  if (input.type === 'reset') {
    return { state: initialState(state.playing, state.seq), effects: [] };
  }
  const run: Run = {
    s: { ...state, queue: [...state.queue], spokenKeys: new Set(state.spokenKeys) },
    nowMs,
    effects: [],
  };
  const { s } = run;

  switch (input.type) {
    case 'cue':
      offer(run, cueItem(input.cue, s.cueWording.get(input.cue.featureId)));
      break;
    case 'cueWording': {
      const wording = new Map(s.cueWording);
      wording.set(input.wording.featureId, input.wording);
      s.cueWording = wording;
      break;
    }
    case 'voiceActivity':
      if (input.active && !s.inputActive) s.pendingQueryId = undefined;
      s.inputActive = input.active;
      if (input.active) interruptForUser(run);
      else s.quietUntilMs = nowMs + CONVERSATION_QUIET_MS;
      break;
    case 'query':
      s.pendingQueryId = input.id;
      interruptForUser(run);
      break;
    case 'answer':
      if (s.inputActive || (s.pendingQueryId && s.pendingQueryId !== input.reply.queryId)) {
        decide(run, input.reply.id, 'dropped', 'superseded by user turn');
        break;
      }
      s.pendingQueryId = undefined;
      s.quietUntilMs = nowMs + CONVERSATION_QUIET_MS;
      onAnswer(run, input.reply);
      break;
    case 'advice': {
      const advice = input.advice;
      if (nowMs > advice.expiresMs || !validCoachingText(advice.text)) {
        decide(
          run,
          advice.id,
          'dropped',
          nowMs > advice.expiresMs ? 'expired' : 'invalid coaching',
        );
        break;
      }
      // Replace stale queued vision coaching while preserving route reminders and answers.
      s.queue = s.queue.filter((item) => {
        if (item.origin !== 'vision') return true;
        decide(run, item.sourceId, 'dropped', 'superseded by newer video coaching');
        return false;
      });
      offer(run, {
        origin: 'vision',
        generated: true,
        sourceId: advice.id,
        dedupeKey: `advice:${advice.id}`,
        text: advice.text,
        ...(advice.delivery ? { delivery: advice.delivery } : {}),
        priority: 1,
        earliestMs: advice.tripMs,
        expiresMs: advice.expiresMs,
        gapMs: 1000,
        why: advice.reason,
        replayed: false,
      });
      break;
    }
    case 'alert':
      offer(run, alertItem(input.alert));
      break;
    case 'speechEnded':
      // Ids that are not current are stale: already interrupted, timed out, or from before a reset.
      if (s.current?.speakId === input.id) finishCurrent(run);
      break;
    case 'voice':
      onVoice(run, input.kind);
      break;
    case 'camera':
      if (!input.ok && !s.cameraPausedSaid) {
        s.cameraPausedSaid = true;
        offer(run, {
          origin: 'system',
          ...CAMERA_PAUSED,
          dedupeKey: CAMERA_PAUSED.sourceId,
          priority: 1,
          earliestMs: nowMs,
          expiresMs: nowMs + SYSTEM_TTL_MS,
          gapMs: REPLAY_GAP_MS,
          why: 'camera health down',
          replayed: false,
        });
      }
      break;
    case 'tripState':
      s.playing = input.state === 'playing';
      break;
    case 'tick':
      watchdog(run);
      break;
  }

  pump(run);
  return { state: s, effects: run.effects };
}

function decide(
  run: Run,
  sourceId: string,
  action: ArbiterDecision['action'],
  reason: string,
  speakId?: string,
) {
  const decision: ArbiterDecision = { sourceId, action, reason, tripMs: run.nowMs };
  if (speakId) decision.speakId = speakId;
  run.effects.push({ type: 'decision', decision });
}

function isDuplicate(s: Draft, key: string): boolean {
  return (
    s.spokenKeys.has(key) ||
    s.queue.some((i) => i.dedupeKey === key) ||
    s.current?.item.dedupeKey === key
  );
}

// Admission: every incoming item is dropped, coalesced, queued or (via pump) spoken.
function offer(run: Run, item: Item) {
  const { s, nowMs } = run;
  const reject = (action: 'dropped' | 'coalesced', reason: string) =>
    decide(run, item.sourceId, action, reason);

  if (item.dedupeKey && isDuplicate(s, item.dedupeKey)) return reject('dropped', 'duplicate');
  if (nowMs > item.expiresMs) return reject('dropped', 'expired');
  // Repeats and answers were asked for out loud, so mute (which silences reminders) lets them through.
  if (item.priority > 0 && s.muted && item.origin !== 'repeat' && item.origin !== 'answer')
    return reject('dropped', 'muted');
  const unsolicited = item.origin === 'vision' || item.origin === 'cue' || item.origin === 'system';
  if (
    item.priority > 0 &&
    unsolicited &&
    (s.inputActive ||
      s.pendingQueryId ||
      s.current?.item.origin === 'answer' ||
      nowMs < s.quietUntilMs)
  )
    return reject('dropped', 'conversation has the floor');
  if (
    item.origin === 'vision' &&
    s.lastProactiveMs !== undefined &&
    nowMs - s.lastProactiveMs < PROACTIVE_GAP_MS
  )
    return reject('dropped', 'coaching cooldown');
  if (item.alertKind) {
    const last = s.lastAlertMs[item.alertKind];
    if (last !== undefined && nowMs - last < ALERT_COOLDOWN_MS) {
      return reject('coalesced', 'within alert cooldown');
    }
  }
  if (item.origin === 'repeat' && s.queue.some((i) => i.origin === 'repeat')) {
    return reject('coalesced', 'repeat already queued');
  }
  if (item.priority === 2 && (s.current || s.queue.length > 0)) return reject('dropped', 'busy');

  if (item.priority === 0 && s.current && s.current.item.priority > 0) interruptCurrent(run);

  const waiting = waitReason(s, item, nowMs);
  if (waiting) decide(run, item.sourceId, 'queued', waiting);
  s.queue.push(item);
}

function waitReason(s: Draft, item: Item, nowMs: number): string | undefined {
  if (!s.playing) return 'waiting: replay not playing';
  if (item.priority > 0 && (s.inputActive || s.pendingQueryId)) return 'waiting: user turn';
  if (s.current) return 'waiting: another line is playing';
  if (item.earliestMs > nowMs) return 'waiting: before earliest time';
  if (readyAt(s, item) > nowMs) return 'waiting: spacing';
  if (s.queue.some((i) => i.priority < item.priority)) return 'waiting: higher priority first';
  return undefined;
}

function interruptForUser(run: Run) {
  const { s, nowMs } = run;
  if (s.current && s.current.item.priority > 0) {
    decide(run, s.current.item.sourceId, 'interrupted', 'interrupted by user', s.current.speakId);
    s.current = undefined;
    s.lastEndMs = nowMs;
  }
  s.queue = s.queue.filter((item) => {
    if (item.priority === 0) return true;
    decide(run, item.sourceId, 'dropped', 'superseded by user turn');
    return false;
  });
}

function interruptCurrent(run: Run) {
  const { s, nowMs } = run;
  const current = s.current;
  if (!current) return;
  const { item, speakId } = current;
  decide(run, item.sourceId, 'interrupted', 'preempted by alert', speakId);
  s.current = undefined;
  s.lastEndMs = nowMs;
  if (item.replayed) {
    decide(run, item.sourceId, 'dropped', 'already replayed once');
  } else if (nowMs > item.expiresMs) {
    decide(run, item.sourceId, 'dropped', 'expired after interrupt');
  } else {
    decide(run, item.sourceId, 'queued', 'replay once if still before expiry');
    s.queue.push({
      ...item,
      replayed: true,
      gapMs: REPLAY_GAP_MS,
      why: 'replay after interrupt',
    });
  }
}

function onVoice(run: Run, kind: 'repeat' | 'mute' | 'unmute') {
  const { s, nowMs } = run;
  if (kind === 'unmute') {
    s.muted = false;
    return;
  }
  if (kind === 'mute') {
    s.muted = true;
    // The line already playing finishes; queued reminders do not start.
    s.queue = s.queue.filter((i) => {
      if (i.priority === 0 || i.origin === 'repeat') return true;
      decide(run, i.sourceId, 'dropped', 'muted');
      return false;
    });
    return;
  }
  const last = s.lastLine;
  if (!last) {
    // Said out loud, so the driver knows the request was heard without looking at the screen.
    offer(run, {
      origin: 'repeat',
      sourceId: 'repeat',
      text: NOTHING_TO_REPEAT,
      priority: 1,
      earliestMs: nowMs,
      expiresMs: nowMs + REPEAT_TTL_MS,
      gapMs: REPLAY_GAP_MS,
      why: 'nothing to repeat',
      replayed: false,
    });
    return;
  }
  offer(run, {
    ...last,
    origin: 'repeat',
    dedupeKey: undefined,
    earliestMs: nowMs,
    expiresMs: nowMs + REPEAT_TTL_MS,
    gapMs: REPLAY_GAP_MS,
    why: 'repeat requested',
    replayed: false,
  });
}

// Claude's reply to a spoken request: its action runs like the fixed voice command, and its text
// is queued like any other line, so a vision warning still interrupts it.
function onAnswer(run: Run, reply: AssistantReply) {
  if (reply.action) onVoice(run, reply.action);
  if (!reply.text || reply.action === 'repeat') return;
  run.s.queue = run.s.queue.filter((item) => {
    if (item.origin !== 'vision') return true;
    decide(run, item.sourceId, 'dropped', 'superseded by requested answer');
    return false;
  });
  const item: Item = {
    origin: 'answer',
    sourceId: reply.id,
    text: reply.text,
    priority: 1,
    earliestMs: run.nowMs,
    expiresMs: run.nowMs + ANSWER_TTL_MS,
    gapMs: REPLAY_GAP_MS,
    why: 'answer to spoken request',
    replayed: false,
  };
  if (reply.delivery) item.delivery = reply.delivery;
  offer(run, item);
}

function readyAt(s: Draft, item: Item): number {
  if (item.priority === 0 || s.lastEndMs === undefined) return item.earliestMs;
  return Math.max(item.earliestMs, s.lastEndMs + item.gapMs);
}

function finishCurrent(run: Run) {
  if (run.s.current?.item.origin === 'answer')
    run.s.quietUntilMs = run.nowMs + CONVERSATION_QUIET_MS;
  run.s.current = undefined;
  run.s.lastEndMs = run.nowMs;
}

// A voice module that never reports speechEnded must not freeze the arbiter.
function watchdog(run: Run) {
  const current = run.s.current;
  if (!current) return;
  const delivery = parseDelivery(current.item.delivery);
  const pace =
    delivery?.speed !== undefined
      ? 1 / delivery.speed
      : delivery?.pace === 'slower'
        ? SLOWER_PACE_FACTOR
        : 1;
  const limitMs = (current.item.text.length / CHARS_PER_SECOND) * 1000 * pace + WATCHDOG_SLACK_MS;
  if (run.nowMs - current.startedMs <= limitMs) return;
  run.effects.push({
    type: 'log',
    message: 'no speechEnded in time; treating the line as finished',
    data: { speakId: current.speakId },
  });
  finishCurrent(run);
}

function pump(run: Run) {
  const { s, nowMs } = run;
  if (!s.playing || s.current) return;
  s.queue = s.queue.filter((i) => {
    if (nowMs <= i.expiresMs) return true;
    decide(run, i.sourceId, 'dropped', 'expired');
    return false;
  });
  const next = s.queue
    .filter(
      (i) => readyAt(s, i) <= nowMs && (i.priority === 0 || (!s.inputActive && !s.pendingQueryId)),
    )
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Number(b.origin === 'answer') - Number(a.origin === 'answer') ||
        a.earliestMs - b.earliestMs,
    )[0];
  if (!next) return;
  s.queue = s.queue.filter((i) => i !== next);
  speak(run, next);
}

function speak(run: Run, item: Item) {
  const { s, nowMs } = run;
  s.seq += 1;
  const speakId = `${item.sourceId}#${s.seq}`;
  s.current = { item, speakId, startedMs: nowMs };
  if (item.origin === 'vision') s.lastProactiveMs = nowMs;
  if (item.dedupeKey) s.spokenKeys.add(item.dedupeKey);
  if (item.alertKind) s.lastAlertMs = { ...s.lastAlertMs, [item.alertKind]: nowMs };
  if (
    item.origin === 'cue' ||
    item.origin === 'answer' ||
    item.origin === 'system' ||
    item.origin === 'vision'
  )
    s.lastLine = item;

  const request: SpeakRequest = {
    id: speakId,
    sourceId: item.sourceId,
    text: item.text,
    priority: item.priority,
    expiresMs: item.expiresMs,
  };
  if (item.generated) request.origin = 'vision';
  if (item.clipKey) request.clipKey = item.clipKey;
  if (item.fallbackClipKey) request.fallbackClipKey = item.fallbackClipKey;
  if (item.delivery) request.delivery = item.delivery;
  run.effects.push({ type: 'speak', request });
  decide(run, item.sourceId, 'spoken', item.why, speakId);
}
