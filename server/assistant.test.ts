import { describe, expect, it, vi } from 'vitest';
import { parseDelivery, type TripContext } from '../shared/assistant.ts';
import { unsafeReason } from '../shared/safeWording.ts';
import {
  ANSWER_EXAMPLES,
  ANSWER_SYSTEM,
  createAssistantHandler,
  DEFLECT,
  MODEL,
  UNAVAILABLE,
  userPrompt,
} from './assistant.ts';

const context: TripContext = {
  speedMps: 9,
  muted: false,
  recentLines: [{ agoS: 4, text: 'Stop sign ahead. Prepare for a complete stop.' }],
  recentAlerts: [],
  upcoming: [{ kind: 'stopSign', street: 'Oxford Street', distM: 60 }],
};

function setup(
  reply: { say: string; action?: string; emotion?: string; pace?: string } | 'refusal' | Error,
) {
  const create = vi.fn(async (body: unknown) => {
    void body;
    if (reply instanceof Error) throw reply;
    if (reply === 'refusal') return { stop_reason: 'refusal', content: [] };
    return {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ action: 'none', ...reply }) }],
    };
  });
  const handler = createAssistantHandler({
    getKey: () => 'test-key',
    createClient: () => ({ beta: { messages: { create } } }) as never,
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handler(
      new Request('https://app.test/api/assistant', {
        method: 'POST',
        headers: { origin: 'https://app.test', ...headers },
        body: JSON.stringify(body),
      }),
    );
  return { create, post, handler };
}

const ask = (question: string) => ({ mode: 'answer', question, context });

describe('assistant endpoint', () => {
  it('answers from the trip context with Sonnet 5.5 at low effort and a fixed schema', async () => {
    const s = setup({ say: 'The stop sign on Oxford Street is about 60 meters ahead.' });
    const response = await s.post(ask('how far is the stop sign'));
    expect(await response.json()).toEqual({
      text: 'The stop sign on Oxford Street is about 60 meters ahead.',
    });
    const body = s.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({
      model: MODEL,
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(JSON.stringify(body.messages)).toContain('Oxford Street');
  });

  it('replaces an unsafe line with a deflection', async () => {
    const s = setup({ say: 'The intersection is clear, go ahead.' });
    expect(await (await s.post(ask('can I go'))).json()).toEqual({ text: DEFLECT });
  });

  it("passes Claude's delivery with its own words, but not with a deflection", async () => {
    const s = setup({ say: "That's completely normal.", emotion: 'sympathetic', pace: 'slower' });
    expect(await (await s.post(ask("I'm nervous"))).json()).toEqual({
      text: "That's completely normal.",
      delivery: { emotion: 'sympathetic', pace: 'slower' },
    });
    const unsafe = setup({ say: 'The lane is clear.', emotion: 'confident', pace: 'normal' });
    expect(await (await unsafe.post(ask('can I merge'))).json()).toEqual({ text: DEFLECT });
  });

  it('drops a delivery outside the fixed set instead of guessing', async () => {
    const s = setup({ say: 'Next is a crosswalk.', emotion: 'panicked', pace: 'normal' });
    expect(await (await s.post(ask("what's next"))).json()).toEqual({
      text: 'Next is a crosswalk.',
    });
  });

  it('asks for emotion and pace in the answer schema and emotion only for cues', async () => {
    const s = setup({ say: 'ok', emotion: 'calm', pace: 'normal' });
    await s.post(ask('hello'));
    await s.post({ mode: 'cue', feature: { kind: 'crosswalk' }, context });
    const schema = (call: number) =>
      (
        s.create.mock.calls[call]![0] as {
          output_config: { format: { schema: { required: string[] } } };
        }
      ).output_config.format.schema.required;
    expect(schema(0)).toEqual(['say', 'action', 'emotion', 'pace']);
    expect(schema(1)).toEqual(['say', 'emotion']);
  });

  it('returns a repeat action without speaking extra text', async () => {
    const s = setup({ say: 'Repeating that.', action: 'repeat' });
    expect(await (await s.post(ask('what did you say'))).json()).toEqual({ action: 'repeat' });
  });

  it('returns mute with its confirmation', async () => {
    const s = setup({ say: 'Reminders muted. Safety warnings still play.', action: 'mute' });
    expect(await (await s.post(ask('be quiet for a bit'))).json()).toEqual({
      action: 'mute',
      text: 'Reminders muted. Safety warnings still play.',
    });
  });

  it('never answers with silence, even when the speech was unclear', async () => {
    const s = setup({ say: '' });
    expect(await (await s.post(ask('uh the thing'))).json()).toEqual({ text: UNAVAILABLE });
  });

  it('a refusal becomes a polite fallback line', async () => {
    const s = setup('refusal');
    expect(await (await s.post(ask('something odd'))).json()).toEqual({ text: UNAVAILABLE });
  });

  it('an upstream failure is a 502', async () => {
    const s = setup(new Error('network down'));
    expect((await s.post(ask('hello'))).status).toBe(502);
  });

  it('words a route cue, and refuses unsafe or empty wording so the template is used', async () => {
    const good = setup({ say: 'Stop sign on Oxford Street. Plan a complete stop.' });
    const cue = { mode: 'cue', feature: { kind: 'stopSign', street: 'Oxford Street' }, context };
    expect(await (await good.post(cue)).json()).toEqual({
      text: 'Stop sign on Oxford Street. Plan a complete stop.',
    });
    expect((await setup({ say: 'Stop sign. The light is green.' }).post(cue)).status).toBe(422);
    expect((await setup({ say: '' }).post(cue)).status).toBe(422);
  });

  it('gives a worded cue its emotion and always the normal pace', async () => {
    const s = setup({ say: 'Crosswalk ahead. Scan both sides.', emotion: 'confident' });
    const cue = { mode: 'cue', feature: { kind: 'crosswalk' }, context };
    expect(await (await s.post(cue)).json()).toEqual({
      text: 'Crosswalk ahead. Scan both sides.',
      delivery: { emotion: 'confident', pace: 'normal' },
    });
  });

  it('rejects cross-origin, malformed and keyless requests before calling Claude', async () => {
    const s = setup({ say: 'hi' });
    expect((await s.post(ask('hi'), { origin: 'https://evil.test' })).status).toBe(403);
    expect((await s.post({ mode: 'answer', question: '', context })).status).toBe(400);
    expect((await s.post({ mode: 'other', context })).status).toBe(400);
    const keyless = createAssistantHandler({ getKey: () => undefined });
    const res = await keyless(
      new Request('https://app.test/api/assistant', { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(503);
    expect(s.create).not.toHaveBeenCalled();
  });

  it('never puts coordinates in the prompt, even if the browser sends them', async () => {
    const s = setup({ say: 'ok' });
    await s.post({
      mode: 'answer',
      question: 'where am I',
      context: { ...context, lat: 37.87, lon: -122.27 },
    });
    const prompt = JSON.stringify(s.create.mock.calls[0]![0]);
    expect(prompt).not.toContain('37.87');
    expect(prompt).not.toContain('-122.27');
  });

  it('sends the rules and examples together for answers, and every example line is safe to speak', async () => {
    const s = setup({ say: 'ok' });
    await s.post(ask('what does a yield sign mean'));
    const body = s.create.mock.calls[0]![0] as { system: string };
    expect(body.system).toContain(ANSWER_SYSTEM);
    expect(body.system).toContain(ANSWER_EXAMPLES);

    const lines = [...ANSWER_EXAMPLES.matchAll(/^\{"say": "([^"]*)", "action"/gm)].map(
      (m) => m[1]!,
    );
    expect(lines.length).toBeGreaterThan(70);
    for (const line of lines.filter(Boolean)) expect(unsafeReason(line), line).toBeUndefined();

    // Every example shows a delivery from the fixed set, so the model never sees an invalid one.
    const outputs = ANSWER_EXAMPLES.split('\n').filter((l) => l.startsWith('{"say"'));
    expect(outputs).toHaveLength(lines.length);
    for (const output of outputs) {
      const { emotion, pace } = JSON.parse(output) as { emotion: unknown; pace: unknown };
      expect(parseDelivery({ emotion, pace }), output).toEqual({ emotion, pace });
    }
  });

  it('frames the question as transcribed speech after the context', () => {
    const prompt = userPrompt({ mode: 'answer', question: 'repeat that', context });
    expect(prompt.indexOf('Trip context')).toBeLessThan(prompt.indexOf('Spoken request'));
  });
});
