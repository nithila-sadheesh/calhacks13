import { useEffect, useState, useSyncExternalStore } from 'react';
import { voiceModule, type HandsFree } from './index.ts';
import { WAKE_WORD } from './wakeword.ts';
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';
import type { MicStatus } from './pushToTalk.ts';

const MIC_LABELS: Record<MicStatus, string> = {
  idle: 'Tap the microphone and ask anything, or say “repeat that”, “mute” or “unmute”.',
  connecting: 'Starting microphone…',
  listening: 'Listening… pause or tap again when you’re done.',
  transcribing: 'Recognizing…',
  error: 'Microphone or voice connection failed. Check permissions and tap to try again.',
};
function handsFreeLabel(h: HandsFree): string {
  switch (h.state) {
    case 'on':
      return `Hands-free on: say “${WAKE_WORD}”, then your question.`;
    case 'starting':
      return 'Starting hands-free…';
    case 'off':
      return 'Hands-free is off.';
    case 'untaught':
      return `Teach hands-free your voice: you'll say “${WAKE_WORD}” three times.`;
    case 'teaching':
      return `Say “${WAKE_WORD}” after the chime (${h.take} of ${h.of}).`;
    case 'error':
      return h.message;
  }
}
const COMMAND_LABELS = { repeat: 'Repeat', mute: 'Mute', unmute: 'Unmute' } as const;
// Shown, never spoken: the assistant stays silent when speech was unclear.
const NOT_HEARD = "Didn't catch that. Tap and try again.";
const ACTION_RESULTS = {
  repeat: 'Repeating the last line.',
  mute: 'Reminders muted. Warnings still play.',
  unmute: 'Reminders back on.',
} as const;

export function VoicePanel({ ctx }: PanelProps) {
  const [audioError, setAudioError] = useState(false);
  // Read from the player, so it is right whichever button unlocked audio (Start drive does too).
  const audioReady = useSyncExternalStore(voiceModule.onAudioReady, voiceModule.audioReady);
  const status = useSyncExternalStore(voiceModule.onMicStatus, voiceModule.micStatus);
  const handsFree = useSyncExternalStore(voiceModule.onHandsFree, voiceModule.handsFree);
  const handsFreeActive = handsFree.state === 'on' || handsFree.state === 'starting';
  const started = useEvents(ctx.bus, 'speechStarted');
  const commands = useEvents(ctx.bus, 'voiceCommand');
  const decisions = useEvents(ctx.bus, 'arbiterDecision');
  const queries = useEvents(ctx.bus, 'voiceQuery');
  const replies = useEvents(ctx.bus, 'assistantReply');
  const query = queries.at(-1);
  const reply = query && [...replies].reverse().find((r) => r.queryId === query.id);
  const last = started.at(-1);
  const command = commands.at(-1);
  // What "repeat" really did, from the arbiter's log, rather than what was asked for.
  const lastRepeat = [...decisions]
    .reverse()
    .find((d) => d.reason === 'repeat requested' || d.reason === 'nothing to repeat');
  const repeatResult =
    lastRepeat?.reason === 'nothing to repeat'
      ? 'Nothing to repeat yet.'
      : lastRepeat
        ? 'Repeating the last line.'
        : 'Repeating…';
  const actionResult = (action: keyof typeof ACTION_RESULTS) =>
    action === 'repeat' ? repeatResult : ACTION_RESULTS[action];
  const active = status === 'connecting' || status === 'listening';
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) voiceModule.cancelTalk();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      voiceModule.cancelTalk();
    };
  }, []);
  return (
    <section className="panel">
      <h2>Voice</h2>
      {!audioReady && (
        <button
          type="button"
          onClick={() => {
            setAudioError(false);
            void voiceModule.enableAudio().catch(() => setAudioError(true));
          }}
        >
          Enable sound
        </button>
      )}
      <p role="status">
        {audioReady
          ? 'Sound on.'
          : audioError
            ? 'Could not enable sound. Try again.'
            : 'Sound is off. Enable it to hear reminders and warnings.'}
      </p>
      <p>{last ? `First audible: ${Math.round(last.firstAudibleMs)} ms` : 'Nothing spoken yet.'}</p>
      <div className="hands-free">
        <p role="status">{handsFreeLabel(handsFree)}</p>
        <div className="hands-free-actions">
          {handsFree.state === 'untaught' || handsFree.state === 'error' ? (
            <button type="button" onClick={() => void voiceModule.teachWakeWord()}>
              {handsFree.state === 'error' ? 'Try again' : `Teach “${WAKE_WORD}”`}
            </button>
          ) : handsFree.state === 'teaching' ? null : (
            <>
              <button
                type="button"
                onClick={() => voiceModule.setHandsFreePreferred(!handsFreeActive)}
              >
                {handsFreeActive ? 'Turn off hands-free' : 'Turn on hands-free'}
              </button>
              {handsFree.state === 'on' && (
                <button type="button" onClick={() => void voiceModule.teachWakeWord()}>
                  Re-teach
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="mic">
        <button
          type="button"
          className={`mic-button mic-${status}`}
          aria-label={active ? 'Stop and send' : 'Talk'}
          aria-pressed={active}
          onClick={() => voiceModule.toggleTalk()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
            <path d="M18 11a6 6 0 0 1-12 0M12 17v4M9 21h6" />
          </svg>
        </button>
        <p role="status">
          {status === 'idle' && handsFree.state === 'on'
            ? `Say “${WAKE_WORD}”, or tap the microphone, then ask anything.`
            : MIC_LABELS[status]}
        </p>
        {command && (!query || command.transcript !== query.transcript) && (
          <p className="muted">
            Heard: {COMMAND_LABELS[command.kind]}
            {command.kind === 'repeat' ? `. ${repeatResult}` : ''}
          </p>
        )}
        {query && (
          <div className="exchange">
            <p className="muted">You asked: “{query.transcript}”</p>
            <p>
              {reply
                ? (reply.text ?? (reply.action ? actionResult(reply.action) : NOT_HEARD))
                : 'Thinking…'}
            </p>
          </div>
        )}
      </div>
      <p className="muted">
        Hands-free listens for “{WAKE_WORD}” on this device only. Microphone audio goes to Cartesia
        only after you say it or tap, until you pause or tap again; questions go to Claude.
      </p>
    </section>
  );
}
