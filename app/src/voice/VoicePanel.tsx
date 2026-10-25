import { useEffect, useState, useSyncExternalStore } from 'react';
import { voiceModule } from './index.ts';
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';
import type { MicStatus } from './pushToTalk.ts';

const MIC_LABELS: Record<MicStatus, string> = {
  idle: 'Tap the microphone and ask anything, or say “repeat that”, “mute” or “unmute”.',
  connecting: 'Starting microphone…',
  listening: 'Listening… tap again when you’re done.',
  transcribing: 'Recognizing…',
  error: 'Microphone or voice connection failed. Check permissions and tap to try again.',
};
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
  const voiceError = useSyncExternalStore(voiceModule.onDiagnostics, voiceModule.voiceError);
  const micError = useSyncExternalStore(voiceModule.onDiagnostics, voiceModule.micError);
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
          disabled={active || status === 'transcribing'}
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
      {voiceError && <p role="alert">{voiceError}</p>}
      <p>{last ? `First audible: ${Math.round(last.firstAudibleMs)} ms` : 'Nothing spoken yet.'}</p>
      <div className="mic">
        <button
          type="button"
          className={`mic-button mic-${status}`}
          aria-label={active ? 'Stop and send' : 'Talk'}
          aria-pressed={active}
          disabled={status === 'transcribing'}
          onPointerDown={(event) => {
            if (event.button !== 0 || status === 'transcribing') return;
            event.preventDefault();
            voiceModule.toggleTalk();
          }}
          onClick={(event) => {
            if (event.detail === 0) voiceModule.toggleTalk();
          }}
          onPointerCancel={() => voiceModule.cancelTalk()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
            <path d="M18 11a6 6 0 0 1-12 0M12 17v4M9 21h6" />
          </svg>
        </button>
        <p role="status">{status === 'error' && micError ? micError : MIC_LABELS[status]}</p>
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
        Microphone audio goes to Cartesia only between your two taps; questions go to Claude. For
        the supervisor or a parked learner.
      </p>
    </section>
  );
}
