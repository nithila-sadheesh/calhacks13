// Mock for the assistant module: answers every spoken question with one fixed line after 300 ms
// and never words route reminders, so templates are spoken. No network.
import type { AppModule } from '../types.ts';

export const MOCK_ANSWER = 'Mock assistant: I heard your question.';

export function createMockAssistant(): AppModule {
  let off: (() => void) | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  return {
    name: 'assistant',
    async start({ bus, clock }) {
      let answers = 0;
      off = bus.on('voiceQuery', (query) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          bus.emit('assistantReply', {
            id: `mock-answer-${++answers}`,
            queryId: query.id,
            text: MOCK_ANSWER,
            tripMs: clock.nowMs(),
          });
        }, 300);
        timers.add(timer);
      });
    },
    stop() {
      off?.();
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}
