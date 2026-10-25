import {
  MAX_COACHING_BODY_BYTES,
  parseCoachingRequest,
  parseCoachingResponse,
} from '../shared/coaching.js';

import { COACHING_PROMPT } from './coachingPrompt.js';
export { COACHING_PROMPT } from './coachingPrompt.js';

const SCHEMA = {
  type: 'object',
  properties: {
    shouldSpeak: { type: 'boolean' },
    message: { type: 'string' },
    reason: { type: 'string' },
    observations: { type: 'array', items: { type: 'string' } },
    uncertainties: { type: 'array', items: { type: 'string' } },
    coachingPoint: { type: 'string' },
    sceneChanged: { type: 'boolean' },
  },
  required: [
    'shouldSpeak',
    'message',
    'reason',
    'observations',
    'uncertainties',
    'coachingPoint',
    'sceneChanged',
  ],
  additionalProperties: false,
};

export function createVisionAdviceHandler(options: {
  getKey: () => string | undefined;
  getModel?: () => string | undefined;
  getRegion?: () => string | undefined;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let windowStart = now();
  let count = 0;
  const json = (body: unknown, status = 200) =>
    Response.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const origin = request.headers.get('origin');
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return json({ error: 'Cross-origin analysis requests are not allowed.' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return json({ error: 'Expected JSON.' }, 415);
    if (Number(request.headers.get('content-length')) > MAX_COACHING_BODY_BYTES)
      return json({ error: 'Frame batch too large.' }, 413);
    let raw: unknown;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'Missing frame batch.' }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_COACHING_BODY_BYTES) {
          await reader.cancel();
          return json({ error: 'Frame batch too large.' }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: 'Invalid frame batch.' }, 400);
    }
    const input = parseCoachingRequest(raw);
    if (!input) return json({ error: 'Invalid frame batch.' }, 400);
    const key = options.getKey()?.trim();
    if (!key) return json({ error: 'Anthropic API key is not configured on the server.' }, 503);
    if (now() - windowStart >= 60_000) {
      windowStart = now();
      count = 0;
    }
    if (++count > 30)
      return json({ error: 'Analysis rate limit reached. Try again shortly.' }, 429);
    try {
      const content = input.scene
        ? [
            {
              type: 'text',
              text: `LOCAL CV INPUT ONLY: No images are supplied. These are tentative local detector/tracker observations, not a complete scene description. Image position/motion/size change is not physical distance, velocity, approach direction or collision risk. IDs can switch. Do not infer pavement, crossings, parked state, lanes, turn intention, jurisdiction, signal colors, speed limits, complete stops, arrival order or all-way controls from this payload. A stop sign detection does not establish which approach it controls. Those facts are UNKNOWN. Use a short object-specific observation/preparation cue only when the supplied observations support it; otherwise choose silence. Do not copy absent context from written examples. Previous detector snapshots: ${JSON.stringify(input.previousScenes ?? [])}. Current snapshot: ${JSON.stringify(input.scene)}.`,
            },
          ]
        : input.frames!.flatMap((frame) => [
            {
              type: 'text',
              text: `Frame at ${(frame.tripMs / 1000).toFixed(2)} seconds of replay:`,
            },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: frame.jpeg },
            },
          ]);
      content.push({
        type: 'text',
        text: `Previous model observations (not verified facts; uncertainty must be preserved): ${JSON.stringify(input.sceneMemory ?? [])}. Recent suggestions: ${JSON.stringify(input.recentAdvice)}. Analyze the current scene.`,
      });
      const model = options.getModel?.() || 'claude-sonnet-5-5';
      const fastSonnet = model === 'claude-sonnet-5-5';
      const response = await fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]),
        body: JSON.stringify({
          model,
          ...(fastSonnet ? { thinking: { type: 'between_tools' } } : {}),
          max_tokens: 700,
          system: [
            { type: 'text', text: COACHING_PROMPT, cache_control: { type: 'ephemeral' } },
            {
              type: 'text',
              text: `Server-configured jurisdiction: ${options.getRegion?.() || 'unknown; do not assign vehicle priority using California rules'}.`,
            },
          ],
          messages: [{ role: 'user', content }],
          output_config: {
            ...(fastSonnet ? { effort: 'low' } : {}),
            format: { type: 'json_schema', schema: SCHEMA },
          },
        }),
      });
      if (!response.ok)
        return json(
          { error: 'Anthropic analysis request failed.', upstreamStatus: response.status },
          [401, 403, 429].includes(response.status) ? response.status : 502,
        );
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object')
        return json({ error: 'Invalid analysis response.' }, 502);
      const result = body as Record<string, unknown>;
      if (result.stop_reason !== 'end_turn' || !Array.isArray(result.content))
        return json({ error: 'Analysis was incomplete or refused.' }, 502);
      const text = result.content
        .filter(
          (block: unknown): block is { type: 'text'; text: string } =>
            !!block &&
            typeof block === 'object' &&
            'type' in block &&
            block.type === 'text' &&
            'text' in block &&
            typeof block.text === 'string',
        )
        .map((block) => block.text)
        .join('');
      const advice = parseCoachingResponse(JSON.parse(text));
      if (
        !advice ||
        !advice.observations ||
        !advice.uncertainties ||
        advice.coachingPoint === undefined ||
        advice.sceneChanged === undefined
      )
        return json({ error: 'Analysis did not meet coaching constraints.' }, 502);
      return json(advice);
    } catch {
      return json({ error: 'Analysis unavailable or timed out.' }, 502);
    }
  };
}
