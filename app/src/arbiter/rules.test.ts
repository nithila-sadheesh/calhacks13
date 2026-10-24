// One describe per rule in the arbiter table in docs/DESIGN.md (section "Rohit").
import { describe, expect, it } from 'vitest';
import type { ArbiterDecision, MapCue, WebcamAlert } from '../../../shared/types.ts';
import {
  ALERT_COOLDOWN_MS,
  CAMERA_PAUSED,
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

  it('drops a repeat when no cue has been spoken', () => {
    const h = new Harness();
    h.send({ type: 'voice', kind: 'repeat' }, 0);
    expect(h.decisions).toEqual([['repeat', 'dropped', 'nothing to repeat']]);
  });

  it('does not repeat an alert', () => {
    const h = new Harness();
    h.send({ type: 'alert', alert: alert() }, 0);
    h.end(1500);
    h.send({ type: 'voice', kind: 'repeat' }, 2000);
    expect(h.decisions.at(-1)).toEqual(['repeat', 'dropped', 'nothing to repeat']);
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
