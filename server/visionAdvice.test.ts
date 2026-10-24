import { expect, it, vi } from 'vitest';
import { createVisionAdviceHandler } from './visionAdvice.ts';
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
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
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
