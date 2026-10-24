import { useEffect, useSyncExternalStore } from 'react';
import { voiceModule } from './index.ts';
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';
import type { MicStatus } from './pushToTalk.ts';

const MIC_LABELS: Record<MicStatus, string> = {
  idle: 'Hold to talk. Say “repeat that”, “mute”, or “unmute”.',
  connecting: 'Connecting microphone. Keep holding.',
  listening: 'Listening. Release to send the command.',
  transcribing: 'Recognizing command…',
  error: 'Microphone or voice connection failed. Check permissions and try again.',
};
export function VoicePanel({ ctx, audioEnabled = false }: PanelProps & { audioEnabled?: boolean }) {
  const status = useSyncExternalStore(voiceModule.onMicStatus, voiceModule.micStatus);
  const started = useEvents(ctx.bus, 'speechStarted');
  const commands = useEvents(ctx.bus, 'voiceCommand');
  const last = started.at(-1);
  useEffect(() => {
    const release = () => voiceModule.releaseToTalk();
    const hidden = () => {
      if (document.hidden) release();
    };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', hidden);
      voiceModule.cancelTalk();
    };
  }, []);
  return (
    <section className="panel">
      <h2>Voice</h2>
      <p role="status">
        {audioEnabled ? 'Sound enabled for replay.' : 'Enable replay sound to connect the voice.'}
      </p>
      <p>{last ? `First audible: ${Math.round(last.firstAudibleMs)} ms` : 'Nothing spoken yet.'}</p>
      <button
        type="button"
        aria-label="Hold to talk"
        aria-pressed={status === 'listening' || status === 'connecting'}
        style={{ touchAction: 'none' }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          void voiceModule.pressToTalk();
        }}
        onPointerUp={() => voiceModule.releaseToTalk()}
        onPointerCancel={() => voiceModule.releaseToTalk()}
        onLostPointerCapture={() => voiceModule.releaseToTalk()}
        onKeyDown={(event) => {
          if ((event.code === 'Space' || event.code === 'Enter') && !event.repeat) {
            event.preventDefault();
            void voiceModule.pressToTalk();
          }
        }}
        onKeyUp={(event) => {
          if (event.code === 'Space' || event.code === 'Enter') {
            event.preventDefault();
            voiceModule.releaseToTalk();
          }
        }}
        onBlur={() => voiceModule.releaseToTalk()}
      >
        Hold to talk
      </button>
      <p role="status">{MIC_LABELS[status]}</p>
      <p>
        Microphone audio is sent to Cartesia only while held. For the supervisor or a parked
        learner.
      </p>
      {commands.at(-1) && <p>Last command: {commands.at(-1)!.kind}</p>}
    </section>
  );
}
