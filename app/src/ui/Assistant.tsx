// The conversation hero: the spoken question and Claude's answer, large and legible — the demo's
// money moment. Mirrors how VoicePanel reads voiceQuery/assistantReply; cleared on tripReset by
// useEvents. Shows nothing until the first question of the trip.
import { useEvents } from '../../../shared/useEvents.ts';
import type { Bus } from '../../../shared/types.ts';

const ACTION_RESULTS = {
  repeat: 'Repeating the last reminder.',
  mute: 'Reminders muted. Warnings still play.',
  unmute: 'Reminders back on.',
} as const;

export function Assistant({ bus }: { bus: Bus }) {
  const queries = useEvents(bus, 'voiceQuery');
  const replies = useEvents(bus, 'assistantReply');
  const query = queries.at(-1);
  if (!query) return null;

  const reply = [...replies].reverse().find((r) => r.queryId === query.id);
  const answer = reply ? (reply.text ?? (reply.action ? ACTION_RESULTS[reply.action] : '')) : null;

  return (
    <section className="assistant" aria-live="polite">
      <p className="assistant-label">You asked</p>
      <p className="assistant-q">“{query.transcript}”</p>
      <p className={`assistant-a${answer ? '' : ' is-pending'}`}>{answer ?? 'Thinking…'}</p>
    </section>
  );
}
