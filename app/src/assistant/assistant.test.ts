import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../../../shared/bus.ts';
import type { EventName, Events, ModuleContext } from '../../../shared/types.ts';
import { buildContext, emptyMemory } from './context.ts';
import { createAssistantModule, UNAVAILABLE } from './index.ts';

function setup(respond: (body: Record<string, unknown>) => Promise<Response>) {
  let nowMs = 10_000;
  const bus = createBus();
  const ctx: ModuleContext = {
    source: 'live',
    bus,
    clock: { nowMs: () => nowMs, onReset: () => () => {} },
    video: {} as HTMLVideoElement,
    fixtures: { track: { syncOffsetMs: 0, points: [] }, features: [], route: { coordinates: [] } },
  };
  const bodies: Array<Record<string, unknown>> = [];
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return respond(body);
  }) as unknown as typeof fetch;
  const seen: Array<[EventName, unknown]> = [];
  bus.onAny((type, payload) => seen.push([type, payload]));
  const of = <K extends EventName>(type: K) =>
    seen.filter(([t]) => t === type).map(([, p]) => p as Events[K]);
  const module = createAssistantModule(fetcher);
  return {
    bus,
    ctx,
    module,
    bodies,
    of,
    advance: (ms: number) => (nowMs += ms),
    ask: (transcript: string) =>
      bus.emit('voiceQuery', { id: 'query-1', transcript, tripMs: nowMs }),
  };
}

const ok = (body: unknown) => Promise.resolve(Response.json(body));
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('assistant module', () => {
  it('sends the question with a trip summary and posts the reply for the arbiter', async () => {
    const s = setup(() => ok({ text: 'The stop sign is about 60 meters ahead.' }));
    await s.module.start(s.ctx);
    s.bus.emit('position', { tripMs: 9000, lat: 37.87, lon: -122.27, speedMps: 8, headingDeg: 90 });
    s.bus.emit('speak', {
      id: 's1',
      sourceId: 'c1',
      text: 'Stop sign ahead. Prepare for a complete stop.',
      priority: 1,
    });
    s.ask('how far is the stop sign');
    await settle();
    expect(s.bodies[0]).toMatchObject({
      mode: 'answer',
      question: 'how far is the stop sign',
      context: {
        speedMps: 8,
        recentLines: [{ agoS: 0, text: 'Stop sign ahead. Prepare for a complete stop.' }],
      },
    });
    expect(JSON.stringify(s.bodies[0])).not.toContain('37.87');
    expect(s.of('dataSent')).toEqual([
      { destination: 'claude', summary: 'question: "how far is the stop sign"', tripMs: 10_000 },
    ]);
    expect(s.of('assistantReply')).toEqual([
      {
        id: 'answer-1',
        queryId: 'query-1',
        text: 'The stop sign is about 60 meters ahead.',
        tripMs: 10_000,
      },
    ]);
    s.module.stop();
  });

  it('passes the delivery with safe text, never with the apology that replaces unsafe text', async () => {
    const delivery = { emotion: 'sympathetic', pace: 'slower' };
    const s = setup(() => ok({ text: "That's completely normal.", delivery }));
    await s.module.start(s.ctx);
    s.ask("I'm nervous");
    await settle();
    expect(s.of('assistantReply')[0]).toMatchObject({
      text: "That's completely normal.",
      delivery,
    });
    s.module.stop();

    const unsafe = setup(() => ok({ text: 'The intersection is clear.', delivery }));
    await unsafe.module.start(unsafe.ctx);
    unsafe.ask('can I go');
    await settle();
    expect(unsafe.of('assistantReply')[0]?.text).toBe(UNAVAILABLE);
    expect(unsafe.of('assistantReply')[0]?.delivery).toBeUndefined();
    unsafe.module.stop();
  });

  it('passes an action through without inventing text', async () => {
    const s = setup(() => ok({ action: 'repeat' }));
    await s.module.start(s.ctx);
    s.ask('what was that');
    await settle();
    expect(s.of('assistantReply')[0]).toMatchObject({ action: 'repeat' });
    expect(s.of('assistantReply')[0]?.text).toBeUndefined();
    s.module.stop();
  });

  it('says it cannot answer when the server reply is empty', async () => {
    const s = setup(() => ok({}));
    await s.module.start(s.ctx);
    s.ask('uh the thing');
    await settle();
    expect(s.of('assistantReply')[0]).toMatchObject({ queryId: 'query-1', text: UNAVAILABLE });
    expect(s.of('assistantReply')[0]?.action).toBeUndefined();
    s.module.stop();
  });

  it('says it cannot answer when the request fails or the wording is unsafe', async () => {
    const failing = setup(() => Promise.reject(new Error('offline')));
    await failing.module.start(failing.ctx);
    failing.ask('hello');
    await settle();
    expect(failing.of('assistantReply')[0]?.text).toBe(UNAVAILABLE);
    failing.module.stop();

    const unsafe = setup(() => ok({ text: 'The intersection is clear.' }));
    await unsafe.module.start(unsafe.ctx);
    unsafe.ask('can I go');
    await settle();
    expect(unsafe.of('assistantReply')[0]?.text).toBe(UNAVAILABLE);
    unsafe.module.stop();
  });

  it('words each upcoming feature once and skips failures so the template is used', async () => {
    const s = setup((body) =>
      (body.feature as { kind: string }).kind === 'stopSign'
        ? ok({
            text: 'Stop sign on Oxford Street. Plan a complete stop.',
            delivery: { emotion: 'confident', pace: 'normal' },
          })
        : Promise.resolve(new Response(null, { status: 422 })),
    );
    await s.module.start(s.ctx);
    const ahead = (featureId: string, featureKind: Events['featureAhead']['featureKind']) =>
      s.bus.emit('featureAhead', {
        featureId,
        featureKind,
        street: 'Oxford Street',
        distM: 300,
        speedMps: 9,
        tripMs: 10_000,
      });
    ahead('stop-1', 'stopSign');
    ahead('stop-1', 'stopSign');
    ahead('turn-1', 'turnLeft');
    await settle();
    expect(s.bodies.map((b) => b.mode)).toEqual(['cue', 'cue']);
    expect(s.of('cueWording')).toEqual([
      {
        featureId: 'stop-1',
        text: 'Stop sign on Oxford Street. Plan a complete stop.',
        delivery: { emotion: 'confident', pace: 'normal' },
      },
    ]);
    s.module.stop();
  });

  it('drops a reply that arrives after a trip reset', async () => {
    let release!: () => void;
    const s = setup(
      () =>
        new Promise((resolve) => {
          release = () => resolve(Response.json({ text: 'Late answer.' }));
        }),
    );
    await s.module.start(s.ctx);
    s.ask('hello');
    await settle();
    s.bus.emit('tripReset', { tripMs: 0 });
    release();
    await settle();
    expect(s.of('assistantReply')).toEqual([]);
    s.module.stop();
  });
});

describe('trip summary', () => {
  it('estimates how far announced features are now, nearest first, at most three', () => {
    const memory = emptyMemory();
    memory.speedMps = 10;
    const add = (id: string, distM: number) =>
      memory.ahead.set(id, { kind: 'stopSign', distM, speedMps: 10, tripMs: 0 });
    add('a', 400);
    add('b', 100);
    add('c', 50);
    add('d', 300);
    add('e', 250);
    const context = buildContext(memory, 6000);
    expect(context.upcoming.map((f) => f.distM)).toEqual([40, 190, 240]);
    expect(context.speedMps).toBe(10);
  });

  it('forgets lines and alerts older than two minutes', () => {
    const memory = emptyMemory();
    memory.lines = [
      { tripMs: 0, text: 'old' },
      { tripMs: 100_000, text: 'new' },
    ];
    expect(buildContext(memory, 130_000).recentLines).toEqual([{ agoS: 30, text: 'new' }]);
  });
});
