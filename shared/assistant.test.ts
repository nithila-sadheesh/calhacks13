import { expect, it } from 'vitest';
import { parseAssistantRequest } from './assistant.ts';
it('validates local observations and strips unexpected fields before forwarding to Claude', () => {
  const context = {
    muted: false,
    recentLines: [],
    recentAlerts: [],
    upcoming: [],
    localScene: { tripMs: 100, objects: [], gps: [1, 2] },
  };
  const request = parseAssistantRequest({
    mode: 'answer',
    question: 'What should I watch?',
    context,
  });
  expect(request?.context.localScene).toEqual({ tripMs: 100, objects: [] });
  expect(
    parseAssistantRequest({
      mode: 'answer',
      question: 'What?',
      context: { ...context, localScene: { tripMs: -1, objects: [] } },
    }),
  ).toBeUndefined();
});
