// One describe per rule in the arbiter table in docs/DESIGN.md (section "Rohit").
import { describe, expect, it } from 'vitest';
import type {
  ArbiterDecision,
  AssistantReply,
  MapCue,
  WebcamAlert,
} from '../../../shared/types.ts';
import {
  ALERT_COOLDOWN_MS,
  ANSWER_TTL_MS,
  CAMERA_PAUSED,
  NOTHING_TO_REPEAT,
  type ArbiterState,
  type Effect,
  type Input,
  initialState,
  REPLAY_GAP_MS,
  SPACING_MS,
  step,
} from './rules.ts';

function cue(over: Partial<MapCue> = {}): MapCue {
  return {
    id: 'cue-1',
    featureId: 'stop-1',
    featureKind: 'stopSign',
    text: 'Stop sign ahead. Prepare for a complete stop.',
    reason: 'stop sign 74 m ahead at 9 m/s',
    priority: 1,
    earliestMs: 0,
    expiresMs: 10000,
    ...over,
  };
}

function alert(over: Partial<WebcamAlert> = {}): WebcamAlert {
  return {
    id: 'alert-1',
    kind: 'pedestrianNearby',
    text: 'Pedestrian ahead. Stay alert.',
    reason: 'person, conf 0.81, 4 of 5 frames, center region',
    confidence: 0.81,
    tripMs: 0,
    expiresMs: 1500,
    clipKey: 'pedestrianNearby',
    ...over,
  };
}

// Drives the pure arbiter like the module does and records everything it emits.
class Harness {
  state: ArbiterState = initialState(true);
  effects: Effect[] = [];
  send(input: Input, nowMs: number) {
    const out = step(this.state, input, nowMs);
    this.state = out.state;
    this.effects.push(...out.effects);
    return out.effects;
  }
  get speaks() {
    return this.effects.flatMap((e) => (e.type === 'speak' ? [e.request] : []));
  }
  get decisions(): Array<[string, ArbiterDecision['action'], string]> {
    return this.effects.flatMap((e) =>
      e.type === 'decision' ? [[e.decision.sourceId, e.decision.action, e.decision.reason]] : [],
    );
  }
  get currentId() {
    return this.state.current?.speakId;
  }
  end(nowMs: number) {
    const id = this.currentId;
    if (!id) throw new Error('nothing playing');
    this.send({ type: 'speechEnded', id }, nowMs);
  }
}

describe('speaking', () => {
  it('speaks an incoming cue at once when idle, with unique speak id and fallback clip', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 1000);
    expect(h.speaks).toEqual([
      {
        id: 'cue-1#1',
        sourceId: 'cue-1',
        text: 'Stop sign ahead. Prepare for a complete stop.',
        priority: 1,
        expiresMs: 10000,
        fallbackClipKey: 'stopSign',
      },
    ]);
    const spoken = h.effects.find((e) => e.type === 'decision');
    expect(spoken).toEqual({
      type: 'decision',
      decision: {
        sourceId: 'cue-1',
        action: 'spoken',
        reason: 'cue window open',
        tripMs: 1000,
        speakId: 'cue-1#1',
      },
    });
  });

  it('plays one line at a time: a second cue waits for speechEnded', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 1000);
    h.send({ type: 'cue', cue: cue({ id: 'cue-2', featureId: 'cross-1' }) }, 1500);
    expect(h.speaks).toHaveLength(1);
    expect(h.decisions.at(-1)).toEqual(['cue-2', 'queued', 'waiting: another line is playing']);
    h.end(4000);
    h.send({ type: 'tick' }, 4000 + SPACING_MS);
    expect(h.speaks.map((s) => s.sourceId)).toEqual(['cue-1', 'cue-2']);
  });

  it('does not speak a cue before its earliestMs', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue({ earliestMs: 3000 }) }, 1000);
    expect(h.speaks).toHaveLength(0);
    expect(h.decisions).toEqual([['cue-1', 'queued', 'waiting: before earliest time']]);
    h.send({ type: 'tick' }, 3000);
    expect(h.speaks).toHaveLength(1);
  });
});

describe('rule: priority', () => {
  it('a waiting alert goes before a waiting cue', () => {
    const h = new Harness();
    h.send({ type: 'alert', alert: alert({ expiresMs: 20000 }) }, 0);
    h.send({ type: 'cue', cue: cue({ priority: 1, expiresMs: 30000 }) }, 100);
    h.send(
      {
        type: 'alert',
        alert: alert({
          id: 'alert-2',
          kind: 'followingDistance',
          clipKey: 'followingDistance',
          expiresMs: 20000,
        }),
      },
      200,
    );
    h.end(2000);
    expect(h.speaks.map((s) => s.sourceId)).toEqual(['alert-1', 'alert-2']);
  });
});

describe('rule: preemption', () => {
  it('a priority-0 alert interrupts a playing cue immediately', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 1000);
    h.send({ type: 'alert', alert: alert({ tripMs: 2000, expiresMs: 3500 }) }, 2000);
    expect(h.speaks.map((s) => [s.sourceId, s.priority, s.clipKey])).toEqual([
      ['cue-1', 1, undefined],
      ['alert-1', 0, 'pedestrianNearby'],
    ]);
    const interrupted = h.effects.find(
      (e) => e.type === 'decision' && e.decision.action === 'interrupted',
    );
    expect(interrupted).toMatchObject({
      decision: { sourceId: 'cue-1', reason: 'preempted by alert', speakId: 'cue-1#1' },
    });
  });

  it('nothing interrupts priority 0: a second alert waits', () => {
    const h = new Harness();
    h.send({ type: 'alert', alert: alert({ expiresMs: 9000 }) }, 0);
    h.send(
      {
        type: 'alert',
        alert: alert({ id: 'a2', kind: 'followingDistance', clipKey: 'fd', expiresMs: 9000 }),
      },
      500,
    );
    expect(h.speaks).toHaveLength(1);
    expect(h.decisions.at(-1)).toEqual(['a2', 'queued', 'waiting: another line is playing']);
  });

  it('an alert does not wait for spacing', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.end(3000);
    h.send({ type: 'alert', alert: alert({ tripMs: 3100, expiresMs: 4600 }) }, 3100);
    expect(h.speaks.map((s) => s.sourceId)).toEqual(['cue-1', 'alert-1']);
  });
});

describe('rule: expiry', () => {
  it('drops an item that arrives already expired', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue({ expiresMs: 500 }) }, 1000);
    expect(h.speaks).toHaveLength(0);
    expect(h.decisions).toEqual([['cue-1', 'dropped', 'expired']]);
  });

  it('drops a queued item once it passes expiresMs', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.send({ type: 'cue', cue: cue({ id: 'cue-2', featureId: 'x', expiresMs: 2000 }) }, 100);
    h.send({ type: 'tick' }, 2500);
    h.end(3000);
    expect(h.decisions).toContainEqual(['cue-2', 'dropped', 'expired']);
    expect(h.speaks.map((s) => s.sourceId)).toEqual(['cue-1']);
  });
});

describe('rule: duplicates', () => {
  it('never speaks the same featureId twice', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.end(3000);
    h.send({ type: 'cue', cue: cue({ id: 'cue-again' }) }, 9000);
    expect(h.decisions.at(-1)).toEqual(['cue-again', 'dropped', 'duplicate']);
  });

  it('drops a duplicate that arrives while the first is still queued', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue({ earliestMs: 5000 }) }, 0);
    h.send({ type: 'cue', cue: cue({ id: 'cue-again', earliestMs: 5000 }) }, 100);
    expect(h.decisions.at(-1)).toEqual(['cue-again', 'dropped', 'duplicate']);
  });

  it('never speaks the same alert id twice', () => {
    const h = new Harness();
    h.send({ type: 'alert', alert: alert({ expiresMs: 99999 }) }, 0);
    h.end(2000);
    h.send({ type: 'alert', alert: alert({ expiresMs: 99999 }) }, 20000);
    expect(h.decisions.at(-1)).toEqual(['alert-1', 'dropped', 'duplicate']);
  });
});

describe('rule: coalescing', () => {
  it('merges a repeat alert of the same kind within the cooldown', () => {
    const h = new Harness();
    h.send({ type: 'alert', alert: alert() }, 0);
    h.end(1500);
    h.send({ type: 'alert', alert: alert({ id: 'a2', tripMs: 5000, expiresMs: 6500 }) }, 5000);
    expect(h.decisions.at(-1)).toEqual(['a2', 'coalesced', 'within alert cooldown']);
  });

  it('speaks the same kind again after the cooldown', () => {
    const h = new Harness();
    h.send({ type: 'alert', alert: alert() }, 0);
    h.end(1500);
    const t = ALERT_COOLDOWN_MS + 1;
    h.send({ type: 'alert', alert: alert({ id: 'a2', tripMs: t, expiresMs: t + 1500 }) }, t);
    expect(h.speaks.map((s) => s.sourceId)).toEqual(['alert-1', 'a2']);
  });
});

describe('rule: interrupted cue', () => {
  it('replays the interrupted cue once after the alert, if still before expiry', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue({ expiresMs: 9000 }) }, 1000);
    h.send({ type: 'alert', alert: alert({ tripMs: 2000, expiresMs: 3500 }) }, 2000);
    h.end(3500);
    h.send({ type: 'tick' }, 3500 + REPLAY_GAP_MS);
    expect(h.speaks.map((s) => s.id)).toEqual(['cue-1#1', 'alert-1#2', 'cue-1#3']);
    expect(h.decisions.at(-1)).toEqual(['cue-1', 'spoken', 'replay after interrupt']);
  });

  it('drops the interrupted cue if it expires before the alert ends', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue({ expiresMs: 3000 }) }, 1000);
    h.send({ type: 'alert', alert: alert({ tripMs: 2000, expiresMs: 3500 }) }, 2000);
    h.end(3500);
    expect(h.decisions).toContainEqual(['cue-1', 'dropped', 'expired']);
    expect(h.speaks.map((s) => s.sourceId)).toEqual(['cue-1', 'alert-1']);
  });

  it('replays only once', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue({ expiresMs: 60000 }) }, 1000);
    h.send({ type: 'alert', alert: alert({ tripMs: 2000, expiresMs: 3500 }) }, 2000);
    h.end(3000);
    h.send({ type: 'tick' }, 4000);
    const t = 4000 + ALERT_COOLDOWN_MS;
    h.send({ type: 'alert', alert: alert({ id: 'a2', tripMs: t, expiresMs: t + 1500 }) }, t);
    expect(h.speaks.map((s) => s.id)).toEqual(['cue-1#1', 'alert-1#2', 'cue-1#3', 'a2#4']);
    expect(h.decisions).toContainEqual(['cue-1', 'dropped', 'already replayed once']);
  });
});

describe('rule: spacing', () => {
  it('starts a fresh cue no sooner than SPACING_MS after the last line ended', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.end(3000);
    h.send({ type: 'cue', cue: cue({ id: 'cue-2', featureId: 'x' }) }, 4000);
    expect(h.decisions.at(-1)).toEqual(['cue-2', 'queued', 'waiting: spacing']);
    h.send({ type: 'tick' }, 3000 + SPACING_MS - 1);
    expect(h.speaks).toHaveLength(1);
    h.send({ type: 'tick' }, 3000 + SPACING_MS);
    expect(h.speaks).toHaveLength(2);
  });

  it('drops a priority-2 advisory when something is playing or queued', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.send({ type: 'cue', cue: cue({ id: 'adv', featureId: 'y', priority: 2 }) }, 100);
    expect(h.decisions.at(-1)).toEqual(['adv', 'dropped', 'busy']);
  });
});

describe('rule: mute', () => {
  it('drops new priority 1-2 items while muted, but alerts still play', () => {
    const h = new Harness();
    h.send({ type: 'voice', kind: 'mute' }, 0);
    h.send({ type: 'cue', cue: cue() }, 100);
    h.send({ type: 'alert', alert: alert({ tripMs: 200, expiresMs: 1700 }) }, 200);
    expect(h.decisions[0]).toEqual(['cue-1', 'dropped', 'muted']);
    expect(h.speaks.map((s) => s.sourceId)).toEqual(['alert-1']);
  });

  it('drops queued reminders on mute and lets the current line finish', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.send({ type: 'cue', cue: cue({ id: 'cue-2', featureId: 'x' }) }, 100);
    h.send({ type: 'voice', kind: 'mute' }, 200);
    expect(h.decisions.at(-1)).toEqual(['cue-2', 'dropped', 'muted']);
    expect(h.currentId).toBe('cue-1#1');
  });

  it('speaks again after unmute', () => {
    const h = new Harness();
    h.send({ type: 'voice', kind: 'mute' }, 0);
    h.send({ type: 'voice', kind: 'unmute' }, 100);
    h.send({ type: 'cue', cue: cue() }, 200);
    expect(h.speaks).toHaveLength(1);
  });
});

describe('rule: repeat', () => {
  it('re-speaks the last route cue text with a new speak id', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.end(3000);
    h.send({ type: 'voice', kind: 'repeat' }, 3500);
    h.send({ type: 'tick' }, 3000 + REPLAY_GAP_MS);
    expect(h.speaks.map((s) => [s.id, s.text])).toEqual([
      ['cue-1#1', 'Stop sign ahead. Prepare for a complete stop.'],
      ['cue-1#2', 'Stop sign ahead. Prepare for a complete stop.'],
    ]);
    expect(h.decisions.at(-1)).toEqual(['cue-1', 'spoken', 'repeat requested']);
  });

  it('works after the cue expired and while muted, because it was asked for', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue({ expiresMs: 4000 }) }, 0);
    h.end(3000);
    h.send({ type: 'voice', kind: 'mute' }, 3100);
    h.send({ type: 'voice', kind: 'repeat' }, 20000);
    expect(h.speaks).toHaveLength(2);
  });

  it('says out loud that there is nothing to repeat when nothing was said yet', () => {
    const h = new Harness();
    h.send({ type: 'voice', kind: 'repeat' }, 0);
    expect(h.speaks.map((s) => [s.sourceId, s.text])).toEqual([['repeat', NOTHING_TO_REPEAT]]);
    expect(h.decisions).toEqual([['repeat', 'spoken', 'nothing to repeat']]);
  });

  it('does not repeat an alert', () => {
    const h = new Harness();
    h.send({ type: 'alert', alert: alert() }, 0);
    h.end(1500);
    h.send({ type: 'voice', kind: 'repeat' }, 2000);
    h.send({ type: 'tick' }, 1500 + REPLAY_GAP_MS);
    expect(h.speaks.at(-1)?.text).toBe(NOTHING_TO_REPEAT);
  });

  it('repeats the last line of any kind except a warning: here, an answer', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.end(3000);
    h.send(
      {
        type: 'answer',
        reply: { id: 'answer-1', queryId: 'q-1', text: 'The stop sign is close.', tripMs: 4000 },
      },
      4000,
    );
    h.end(6000);
    h.send({ type: 'alert', alert: alert({ tripMs: 7000, expiresMs: 8500 }) }, 7000);
    h.end(8500);
    h.send({ type: 'voice', kind: 'repeat' }, 9000);
    h.send({ type: 'tick' }, 8500 + REPLAY_GAP_MS);
    expect(h.speaks.at(-1)).toMatchObject({
      sourceId: 'answer-1',
      text: 'The stop sign is close.',
    });
    expect(h.decisions.at(-1)).toEqual(['answer-1', 'spoken', 'repeat requested']);
  });

  it("repeats an answer the way it was first said, with Claude's delivery", () => {
    const h = new Harness();
    const delivery = { emotion: 'sympathetic', pace: 'slower' } as const;
    h.send(
      {
        type: 'answer',
        reply: { id: 'answer-1', queryId: 'q-1', text: 'That is okay.', delivery, tripMs: 0 },
      },
      0,
    );
    h.end(2000);
    h.send({ type: 'voice', kind: 'repeat' }, 3500);
    expect(h.speaks.map((s) => [s.sourceId, s.delivery])).toEqual([
      ['answer-1', delivery],
      ['answer-1', delivery],
    ]);
  });

  it('a repeated camera-paused line plays its clip again', () => {
    const h = new Harness();
    h.send({ type: 'camera', ok: false }, 0);
    h.end(2000);
    h.send({ type: 'voice', kind: 'repeat' }, 3000);
    expect(h.speaks.at(-1)).toMatchObject({ clipKey: 'cameraPaused' });
  });

  it('coalesces a second repeat while one is queued', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.send({ type: 'voice', kind: 'repeat' }, 100);
    h.send({ type: 'voice', kind: 'repeat' }, 200);
    expect(h.decisions.at(-1)).toEqual(['cue-1', 'coalesced', 'repeat already queued']);
  });
});

describe('rule: camera down', () => {
  it('speaks the camera-paused clip once per trip', () => {
    const h = new Harness();
    h.send({ type: 'camera', ok: false }, 0);
    h.end(2000);
    h.send({ type: 'camera', ok: true }, 3000);
    h.send({ type: 'camera', ok: false }, 4000);
    expect(h.speaks).toEqual([
      expect.objectContaining({
        sourceId: CAMERA_PAUSED.sourceId,
        text: 'Camera paused. Route reminders only.',
        clipKey: 'cameraPaused',
        priority: 1,
      }),
    ]);
  });
});

describe('rule: reset', () => {
  it('clears queue, cooldowns, fired ids, last cue and mute; keeps ids unique', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.send({ type: 'cue', cue: cue({ id: 'cue-2', featureId: 'x' }) }, 100);
    h.send({ type: 'alert', alert: alert({ tripMs: 200, expiresMs: 1700 }) }, 200);
    h.send({ type: 'voice', kind: 'mute' }, 300);
    h.send({ type: 'reset' }, 0);
    expect(h.state).toEqual({ ...initialState(true), seq: h.state.seq });

    h.send({ type: 'cue', cue: cue() }, 500);
    expect(h.speaks.at(-1)?.id).toBe(`cue-1#${h.state.seq}`);
    expect(new Set(h.speaks.map((s) => s.id)).size).toBe(h.speaks.length);
  });

  it('ignores a stale speechEnded from before the reset', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    const stale = h.currentId ?? '';
    h.send({ type: 'reset' }, 0);
    h.send({ type: 'cue', cue: cue() }, 100);
    h.send({ type: 'speechEnded', id: stale }, 200);
    expect(h.currentId).toBeDefined();
    expect(h.currentId).not.toBe(stale);
  });
});

describe('pause and watchdog', () => {
  it('does not start anything while the replay is not playing', () => {
    const h = new Harness();
    h.send({ type: 'tripState', state: 'paused' }, 0);
    h.send({ type: 'cue', cue: cue() }, 0);
    expect(h.speaks).toHaveLength(0);
    expect(h.decisions).toEqual([['cue-1', 'queued', 'waiting: replay not playing']]);
    h.send({ type: 'tripState', state: 'playing' }, 0);
    expect(h.speaks).toHaveLength(1);
  });

  it('frees the arbiter if speechEnded never arrives', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.send({ type: 'tick' }, 60000);
    expect(h.currentId).toBeUndefined();
    expect(h.effects.some((e) => e.type === 'log')).toBe(true);
  });
});

describe('assistant', () => {
  const reply = (over: Partial<AssistantReply> = {}): AssistantReply => ({
    id: 'answer-1',
    queryId: 'q-1',
    text: 'The stop sign is about 60 meters ahead.',
    tripMs: 0,
    ...over,
  });

  it('speaks Claude wording for a cue when it arrived first, the template otherwise', () => {
    const h = new Harness();
    h.send(
      {
        type: 'cueWording',
        wording: {
          featureId: 'stop-1',
          text: 'Stop sign on Oxford. Plan a full stop.',
          delivery: { emotion: 'confident', pace: 'normal' },
        },
      },
      0,
    );
    h.send({ type: 'cue', cue: cue() }, 1000);
    expect(h.speaks[0]).toMatchObject({
      text: 'Stop sign on Oxford. Plan a full stop.',
      fallbackClipKey: 'stopSign',
      delivery: { emotion: 'confident', pace: 'normal' },
    });
    expect(h.decisions[0]).toEqual(['cue-1', 'spoken', 'cue window open (Claude wording)']);
    h.end(3000);
    h.send(
      {
        type: 'cue',
        cue: cue({
          id: 'cue-2',
          featureId: 'turn-1',
          featureKind: 'turnLeft',
          text: 'Left turn ahead onto Main. Check for pedestrians before turning.',
        }),
      },
      8000,
    );
    expect(h.speaks[1]?.text).toBe(
      'Left turn ahead onto Main. Check for pedestrians before turning.',
    );
    // A template is an approved phrase in the default voice; it never borrows a delivery.
    expect(h.speaks[1]?.delivery).toBeUndefined();
  });

  it("speaks an answer with Claude's delivery, and gives a slower line more time", () => {
    const delivery = { emotion: 'sympathetic', pace: 'slower' } as const;
    const slow = new Harness();
    slow.send({ type: 'answer', reply: reply({ delivery }) }, 1000);
    expect(slow.speaks[0]?.delivery).toEqual(delivery);
    slow.send({ type: 'tick' }, 12000);
    expect(slow.currentId).toBeDefined();

    const normal = new Harness();
    normal.send({ type: 'answer', reply: reply() }, 1000);
    expect(normal.speaks[0]?.delivery).toBeUndefined();
    normal.send({ type: 'tick' }, 12000);
    expect(normal.currentId).toBeUndefined();
  });

  it('a reset forgets wording from the previous pass', () => {
    const h = new Harness();
    h.send({ type: 'cueWording', wording: { featureId: 'stop-1', text: 'Claude wording.' } }, 0);
    h.send({ type: 'reset' }, 100);
    h.send({ type: 'cue', cue: cue() }, 1000);
    expect(h.speaks[0]?.text).toBe(cue().text);
  });

  it('speaks an answer, and a vision warning still interrupts it', () => {
    const h = new Harness();
    h.send({ type: 'answer', reply: reply() }, 1000);
    expect(h.speaks[0]).toMatchObject({
      sourceId: 'answer-1',
      text: 'The stop sign is about 60 meters ahead.',
      priority: 1,
    });
    h.send({ type: 'alert', alert: alert({ tripMs: 1500, expiresMs: 3000 }) }, 1500);
    expect(h.decisions).toContainEqual(['answer-1', 'interrupted', 'preempted by alert']);
    expect(h.speaks[1]?.sourceId).toBe('alert-1');
  });

  it('answers while muted, because it was asked for', () => {
    const h = new Harness();
    h.send({ type: 'voice', kind: 'mute' }, 0);
    h.send({ type: 'answer', reply: reply() }, 1000);
    expect(h.speaks.map((s) => s.sourceId)).toEqual(['answer-1']);
  });

  it('a repeat action replays the last cue and speaks nothing else', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 1000);
    h.end(3000);
    h.send({ type: 'answer', reply: reply({ action: 'repeat', text: 'Repeating.' }) }, 5000);
    expect(h.speaks.map((s) => s.text)).toEqual([cue().text, cue().text]);
  });

  it('a repeat replays the last answer when it came after the last cue', () => {
    const h = new Harness();
    h.send({ type: 'cue', cue: cue() }, 0);
    h.end(3000);
    h.send({ type: 'answer', reply: reply() }, 4000);
    h.end(6000);
    h.send({ type: 'voice', kind: 'repeat' }, 6000 + REPLAY_GAP_MS);
    expect(h.speaks.map((s) => s.text)).toEqual([
      cue().text,
      'The stop sign is about 60 meters ahead.',
      'The stop sign is about 60 meters ahead.',
    ]);
  });

  it('a mute action mutes and speaks its confirmation; later reminders are dropped', () => {
    const h = new Harness();
    h.send(
      {
        type: 'answer',
        reply: reply({ action: 'mute', text: 'Reminders muted. Warnings still play.' }),
      },
      1000,
    );
    expect(h.state.muted).toBe(true);
    expect(h.speaks[0]?.text).toBe('Reminders muted. Warnings still play.');
    h.end(3000);
    h.send({ type: 'cue', cue: cue() }, 9000);
    expect(h.decisions).toContainEqual(['cue-1', 'dropped', 'muted']);
  });

  it('drops an answer that waited past its lifetime', () => {
    const h = new Harness();
    h.send({ type: 'tripState', state: 'paused' }, 0);
    h.send({ type: 'answer', reply: reply() }, 1000);
    h.send({ type: 'tripState', state: 'playing' }, 1000 + ANSWER_TTL_MS + 1);
    expect(h.decisions).toContainEqual(['answer-1', 'dropped', 'expired']);
    expect(h.speaks).toEqual([]);
  });
});

it('queues generated coaching ahead of map cues and repeats the latest coaching', () => {
  const advice = {
    id: 'vlm-1',
    text: 'Watch for cyclists beside parked cars.',
    reason: 'Cyclist beside cars.',
    tripMs: 1000,
    expiresMs: 11000,
  };
  let result = step(initialState(true), { type: 'advice', advice }, 1000);
  const spoken = result.effects.find((effect) => effect.type === 'speak');
  expect(spoken).toMatchObject({ request: { origin: 'vision', text: advice.text, priority: 1 } });
  if (spoken?.type !== 'speak') throw new Error('Expected coaching speech');
  result = step(result.state, { type: 'speechEnded', id: spoken.request.id }, 2000);
  result = step(result.state, { type: 'voice', kind: 'repeat' }, 4000);
  expect(result.effects.find((effect) => effect.type === 'speak')).toMatchObject({
    request: { origin: 'vision', text: advice.text },
  });
});

it('replaces queued old coaching but does not let expired advice discard valid queued work', () => {
  const advice = {
    id: 'first',
    text: 'Scan curb edges for pedestrians.',
    reason: 'People beside the road.',
    tripMs: 0,
    expiresMs: 10000,
  };
  let result = step(initialState(false), { type: 'advice', advice }, 0);
  result = step(
    result.state,
    {
      type: 'advice',
      advice: { ...advice, id: 'second', text: 'Check mirrors for nearby cyclists.' },
    },
    1000,
  );
  expect(result.state.queue.map((item) => item.sourceId)).toEqual(['second']);
  expect(result.effects).toContainEqual(
    expect.objectContaining({
      type: 'decision',
      decision: expect.objectContaining({ sourceId: 'first', action: 'dropped' }),
    }),
  );
  result = step(
    result.state,
    { type: 'advice', advice: { ...advice, id: 'expired', expiresMs: 500 } },
    1000,
  );
  expect(result.state.queue.map((item) => item.sourceId)).toEqual(['second']);
});

it('prioritizes a requested answer over queued vision coaching and preserves delivery', () => {
  const advice = {
    id: 'v1',
    text: 'Keep the car on your left in view.',
    reason: 'Car on left.',
    tripMs: 0,
    expiresMs: 10000,
  };
  let result = step(initialState(false), { type: 'advice', advice }, 0);
  result = step(
    result.state,
    {
      type: 'answer',
      reply: {
        id: 'a1',
        queryId: 'q1',
        text: 'Keep checking your mirrors.',
        delivery: { emotion: 'calm', pace: 'slower' },
        tripMs: 100,
      },
    },
    100,
  );
  result = step(
    result.state,
    { type: 'advice', advice: { ...advice, id: 'v2', tripMs: 200 } },
    200,
  );
  result = step(result.state, { type: 'tripState', state: 'playing' }, 300);
  expect(result.effects.find((effect) => effect.type === 'speak')).toMatchObject({
    request: { sourceId: 'a1', delivery: { emotion: 'calm', pace: 'slower' } },
  });
  expect(result.state.queue.map((item) => item.sourceId)).toEqual([]);
});

const vision = (id: string, tripMs = 0) => ({
  id,
  text: 'Keep the car on your left in view.',
  reason: 'Car on left.',
  tripMs,
  expiresMs: tripMs + 10000,
});

it('interrupts ordinary speech at microphone start and never resumes the interrupted thought', () => {
  const h = new Harness();
  h.send({ type: 'advice', advice: vision('old') }, 0);
  h.send({ type: 'cue', cue: cue() }, 100);
  h.send({ type: 'voiceActivity', active: true }, 200);
  expect(h.currentId).toBeUndefined();
  expect(h.state.queue).toEqual([]);
  expect(h.decisions).toContainEqual(['old', 'interrupted', 'interrupted by user']);
  h.send({ type: 'advice', advice: vision('during', 300) }, 300);
  h.send({ type: 'query', id: 'q1' }, 400);
  h.send({ type: 'voiceActivity', active: false }, 400);
  h.send({ type: 'tick' }, 1000);
  expect(h.speaks).toHaveLength(1);
  h.send(
    {
      type: 'answer',
      reply: {
        id: 'a1',
        queryId: 'q1',
        text: 'Check your mirrors before changing position.',
        tripMs: 1500,
      },
    },
    1500,
  );
  expect(h.speaks.at(-1)?.sourceId).toBe('a1');
  h.end(2000);
  h.send({ type: 'tick' }, 11000);
  expect(h.speaks.map((s) => s.sourceId)).toEqual(['old', 'a1']);
  expect(h.state.queue).toEqual([]);
});

it('lets priority-zero warnings finish and break through a user turn', () => {
  const h = new Harness();
  h.send({ type: 'alert', alert: alert() }, 0);
  const warningId = h.currentId;
  h.send({ type: 'voiceActivity', active: true }, 100);
  expect(h.currentId).toBe(warningId);
  h.end(500);
  h.send(
    { type: 'alert', alert: alert({ id: 'new-alert', tripMs: 9000, expiresMs: 10500 }) },
    9000,
  );
  expect(h.speaks.at(-1)?.sourceId).toBe('new-alert');
  expect(h.speaks.at(-1)?.priority).toBe(0);
});

it('uses normal speech spacing without an extra coaching cooldown or post-answer quiet period', () => {
  const h = new Harness();
  h.send({ type: 'advice', advice: vision('first') }, 0);
  h.end(1000);
  h.send({ type: 'advice', advice: vision('next', 2000) }, 2000);
  expect(h.speaks.at(-1)?.sourceId).toBe('next');
  h.end(3000);

  h.send({ type: 'query', id: 'q1' }, 4000);
  h.send({ type: 'voiceActivity', active: false }, 4100);
  h.send(
    {
      type: 'answer',
      reply: { id: 'a1', queryId: 'q1', text: 'Check your mirrors.', tripMs: 5000 },
    },
    5000,
  );
  expect(h.speaks.at(-1)?.sourceId).toBe('a1');
  h.send({ type: 'advice', advice: vision('during-answer', 5500) }, 5500);
  expect(h.decisions).toContainEqual(['during-answer', 'dropped', 'conversation has the floor']);
  h.end(6000);
  h.send({ type: 'advice', advice: vision('after-answer', 7000) }, 7000);
  expect(h.speaks.at(-1)?.sourceId).toBe('after-answer');
});

it('releases the floor when a new microphone attempt is cancelled instead of waiting for an obsolete answer', () => {
  const h = new Harness();
  h.send({ type: 'query', id: 'old-query' }, 0);
  h.send({ type: 'voiceActivity', active: true }, 100);
  h.send({ type: 'voiceActivity', active: false }, 200);
  expect(h.state.pendingQueryId).toBeUndefined();
  h.send({ type: 'advice', advice: vision('fresh', 10000) }, 10000);
  expect(h.speaks.at(-1)?.sourceId).toBe('fresh');
});
