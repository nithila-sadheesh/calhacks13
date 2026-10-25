// The one hands-free control: a large microphone orb that reflects the real voice state
// (idle / connecting / listening / transcribing → thinking / speaking) and toggles push-to-talk.
// It reads voiceModule (ui already imports it in Drive) and derives speaking/thinking from the bus.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Bus } from '../../../shared/types.ts';
import { voiceModule } from '../voice/index.ts';

type OrbState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

const LABELS: Record<OrbState, string> = {
  idle: 'Tap to ask',
  connecting: 'Connecting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  error: 'Tap to try again',
};

export function MicOrb({ bus, active }: { bus: Bus; active: boolean }) {
  const micStatus = useSyncExternalStore(voiceModule.onMicStatus, voiceModule.micStatus);
  const audioReady = useSyncExternalStore(voiceModule.onAudioReady, voiceModule.audioReady);
  const [speaking, setSpeaking] = useState(false);
  const [pendingReply, setPendingReply] = useState(false);

  useEffect(() => {
    const offs = [
      bus.on('speechStarted', () => setSpeaking(true)),
      bus.on('speechEnded', () => setSpeaking(false)),
      bus.on('voiceQuery', () => setPendingReply(true)),
      bus.on('assistantReply', () => setPendingReply(false)),
      bus.on('tripReset', () => {
        setSpeaking(false);
        setPendingReply(false);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [bus]);

  const state: OrbState =
    micStatus === 'error'
      ? 'error'
      : micStatus === 'listening'
        ? 'listening'
        : micStatus === 'connecting'
          ? 'connecting'
          : micStatus === 'transcribing' || pendingReply
            ? 'thinking'
            : speaking
              ? 'speaking'
              : 'idle';

  const needsSound = active && !audioReady;
  const label = !active ? LABELS.idle : needsSound ? 'Enable sound' : LABELS[state];

  const onClick = () => {
    if (!active) return;
    if (needsSound) {
      void voiceModule.enableAudio().catch(() => undefined);
      return;
    }
    voiceModule.toggleTalk();
  };

  return (
    <div className="dock">
      <button
        type="button"
        className={`mic-orb is-${state}`}
        aria-label={label}
        aria-pressed={state === 'listening'}
        disabled={!active}
        onClick={onClick}
      >
        <OrbIcon state={state} />
      </button>
      <p className="mic-orb-label">{label}</p>
    </div>
  );
}

function OrbIcon({ state }: { state: OrbState }) {
  if (state === 'thinking') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (state === 'speaking') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 10v4M9.5 7v10M14.5 7v10M19 10v4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
      <path d="M18 11a6 6 0 0 1-12 0M12 17v4M9 21h6" />
    </svg>
  );
}
