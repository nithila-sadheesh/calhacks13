import { expect, it, vi } from 'vitest';
import { COACHING_PROMPT, createVisionAdviceHandler } from './visionAdvice.ts';
const input = {
  frames: [
    { tripMs: 1000, jpeg: '/9j/AA==' },
    { tripMs: 2000, jpeg: '/9j/AA==' },
  ],
  recentAdvice: [],
};
const request = (body: unknown = input, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/vision-advice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const advice = {
  shouldSpeak: true,
  message: 'Watch for cyclists beside parked vehicles.',
  reason: 'A cyclist is visible.',
  observations: ['A cyclist is beside parked cars.'],
  uncertainties: ['Intended movement is unknown.'],
  coachingPoint: 'Identify the specific space restriction.',
  sceneChanged: false,
};
it('sends only validated frames to Anthropic and returns validated JSON', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(advice) }],
    }),
  );
  const handler = createVisionAdviceHandler({ getKey: () => 'test-only-key', fetcher });
  const response = await handler(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(advice);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://api.anthropic.com/v1/messages');
  const sent = JSON.parse(String(options?.body)) as {
    model: string;
    thinking?: { type: string };
    system: Array<{ type: string; cache_control?: { type: string } }>;
    output_config: { effort?: string };
    messages: unknown[];
  };
  expect(sent.model).toBe('claude-sonnet-5-5');
  expect(sent.output_config.effort).toBe('low');
  expect(sent.thinking?.type).toBe('between_tools');
  expect(sent.system[0]?.cache_control?.type).toBe('ephemeral');
  expect(sent.system[1]?.cache_control).toBeUndefined();
  expect(JSON.stringify(sent)).not.toContain('test-only-key');
});
it('rejects invalid, oversized and cross-origin input before contacting the model', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const handler = createVisionAdviceHandler({ getKey: () => 'test-only-key', fetcher });
  expect((await handler(request({}, { Origin: 'https://untrusted.example' }))).status).toBe(403);
  expect((await handler(request({ frames: [] }))).status).toBe(400);
  expect((await handler(request(input, { 'Content-Length': '900000' }))).status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
  const missing = createVisionAdviceHandler({ getKey: () => undefined, fetcher });
  expect((await missing(request())).status).toBe(503);
});
it('fails closed on refusals, bad wording, upstream errors and exceptions', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const handler = createVisionAdviceHandler({ getKey: () => 'test-only-key', fetcher });
  for (const body of [
    { stop_reason: 'refusal', content: [] },
    { stop_reason: 'max_tokens', content: [] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not-json' }] },
    {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ ...advice, message: 'Go now.' }) }],
    },
  ]) {
    fetcher.mockResolvedValueOnce(Response.json(body));
    expect((await handler(request())).status).toBe(502);
  }
  fetcher.mockResolvedValueOnce(new Response('private upstream details', { status: 401 }));
  const rejected = await handler(request());
  expect(rejected.status).toBe(401);
  expect(await rejected.text()).not.toContain('private');
  fetcher.mockRejectedValueOnce(new Error('test-only-key'));
  expect(await (await handler(request())).text()).not.toContain('test-only-key');
});
it('limits request bursts and resets the warm-instance window', async () => {
  let now = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(advice) }],
    }),
  );
  const handler = createVisionAdviceHandler({
    getKey: () => 'test-only-key',
    fetcher,
    now: () => now,
  });
  for (let i = 0; i < 30; i++) expect((await handler(request())).status).toBe(200);
  expect((await handler(request())).status).toBe(429);
  now = 60_001;
  expect((await handler(request())).status).toBe(200);
});

it('does not apply Sonnet-specific thinking options to an overridden model', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(advice) }],
    }),
  );
  const handler = createVisionAdviceHandler({
    getKey: () => 'test-only-key',
    getModel: () => 'claude-haiku-5-5',
    fetcher,
  });
  expect((await handler(request())).status).toBe(200);
  const sent = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as {
    thinking?: unknown;
    output_config: { effort?: string };
  };
  expect(sent.thinking).toBeUndefined();
  expect(sent.output_config.effort).toBeUndefined();
});

it('sends CV observations as text without image blocks or invented scene fields', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(advice) }],
    }),
  );
  const handler = createVisionAdviceHandler({ getKey: () => 'test-only-key', fetcher });
  const scene = {
    tripMs: 1000,
    objects: [
      {
        id: 1,
        class: 'car',
        confidence: 0.9,
        imageSide: 'left',
        imageZone: 'middle',
        imageMotion: 'unknown',
        apparentSize: 'unknown',
        visibleForMs: 600,
      },
    ],
  };
  expect((await handler(request({ scene, recentAdvice: [], previousScenes: [] }))).status).toBe(
    200,
  );
  const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as {
    messages: Array<{ content: Array<{ type: string; text: string }> }>;
  };
  expect(body.messages[0]!.content.every((block) => block.type === 'text')).toBe(true);
  expect(body.messages[0]!.content[0]!.text).toContain('physical distance');
});

it('asks Claude for a delivery, tells it the quiet time and never suggests asking what a sign controls', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(advice) }],
    }),
  );
  const handler = createVisionAdviceHandler({ getKey: () => 'test-only-key', fetcher });
  const scene = { tripMs: 30000, objects: [] };
  await handler(request({ scene, recentAdvice: [], quietForMs: 21000 }));
  const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as {
    system: Array<{ text: string }>;
    messages: Array<{ content: Array<{ text: string }> }>;
    output_config: { format: { schema: { required: string[] } } };
  };
  expect(body.output_config.format.schema.required).toContain('delivery');
  expect(body.messages[0]!.content.at(-1)!.text).toContain('quiet for 21 seconds');
  expect(COACHING_PROMPT).toContain('Speed (');
  // The only mentions of "controls" left in the prompt forbid the topic; no example asks it.
  expect(COACHING_PROMPT).not.toMatch(/check which approach|approaches' controls/i);
});
