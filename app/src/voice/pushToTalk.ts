// Tap to start, tap again to stop. The first tap opens the microphone and an Ink session; the
// second tap stops recording and Ink finalizes the whole utterance. Then a fixed command ("repeat
// that", "mute", "unmute") runs, or anything else goes out as `voiceQuery` for the assistant.
// Nothing ends the recording early: guessing the end from pauses cut people off mid-sentence.
// MAX_LISTEN_MS only stops a microphone left on by mistake. Mic audio goes to Ink only between
// the taps. Audio captured while Ink is still connecting is buffered and sent once it opens.
import type { Bus, TripClock } from '../../../shared/types.ts';
import { commandFromTranscript } from './pcm.ts';
import { openCapture, type CaptureSession } from './capture.ts';
import { openInk, type InkSession } from './ink.ts';

export type MicStatus = 'idle' | 'connecting' | 'listening' | 'transcribing' | 'error';

export const MAX_LISTEN_MS = 30_000;
// Cap on audio held back while Ink connects; older audio is dropped first.
const MAX_BUFFERED_S = 3;

export function createPushToTalk(options: {
  bus: Bus;
  clock: TripClock;
  status: (status: MicStatus) => void;
  capture?: typeof openCapture;
  ink?: typeof openInk;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}) {
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer =
    options.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  type Session = {
    controller: AbortController;
    listening: boolean;
    capture?: CaptureSession;
    ink?: InkSession;
    pending: Float32Array[];
    pendingSamples: number;
    sentSamples: number;
    reported: boolean;
    transcript: string;
    timer?: unknown;
    hearing?: boolean;
  };
  let queries = 0;
  let current: Session | undefined;

  function report(session: Session) {
    if (session.reported || !session.ink || !session.capture) return;
    session.reported = true;
    options.bus.emit('dataSent', {
      destination: 'cartesia-stt',
      summary: `mic audio, ${(session.sentSamples / session.capture.sampleRate).toFixed(2)} s`,
      tripMs: options.clock.nowMs(),
    });
  }
  function close(session: Session) {
    session.listening = false;
    clearTimer(session.timer);
    session.capture?.stop();
    report(session);
    session.controller.abort();
    session.ink?.cancel();
  }
  function cancel() {
    const session = current;
    current = undefined;
    if (session) close(session);
    options.status('idle');
  }
  function fail(session: Session) {
    if (current !== session) return;
    cancel();
    options.status('error');
  }
  function send(session: Session, samples: Float32Array) {
    session.ink!.send(samples);
    session.sentSamples += samples.length;
  }
  // Stop listening and let Ink finalize what it has heard.
  function finish(session: Session) {
    if (current !== session || !session.listening) return;
    session.listening = false;
    clearTimer(session.timer);
    // No microphone yet (permission prompt still open): nothing was heard.
    if (!session.capture) {
      cancel();
      return;
    }
    session.capture.stop();
    // Ink still connecting: start() finalizes the buffered audio once it opens.
    if (!session.ink) {
      options.status('transcribing');
      return;
    }
    report(session);
    options.status('transcribing');
    session.ink.finish();
  }

  async function start() {
    cancel();
    const session: Session = {
      controller: new AbortController(),
      listening: true,
      pending: [],
      pendingSamples: 0,
      sentSamples: 0,
      reported: false,
      transcript: '',
    };
    current = session;
    options.status('connecting');
    try {
      const capture = await (options.capture ?? openCapture)((samples) => {
        if (current !== session || !session.listening) return;
        // "Listening" means audio is really being recorded, not just that the tap happened:
        // anything said before the microphone starts is lost.
        if (!session.hearing) {
          session.hearing = true;
          options.status('listening');
        }
        if (!session.ink) {
          session.pending.push(samples);
          session.pendingSamples += samples.length;
          const max = MAX_BUFFERED_S * (session.capture?.sampleRate ?? 48000);
          while (session.pendingSamples > max && session.pending.length > 1)
            session.pendingSamples -= session.pending.shift()!.length;
          return;
        }
        try {
          send(session, samples);
        } catch {
          fail(session);
        }
      }, session.controller.signal);
      session.capture = capture;
      if (current !== session || !session.listening) {
        capture.stop();
        return;
      }
      // The listening window starts at the tap, while Ink connects; buffered audio counts.
      session.timer = setTimer(() => finish(session), MAX_LISTEN_MS);
      const ink = await (options.ink ?? openInk)({
        sampleRate: capture.sampleRate,
        signal: session.controller.signal,
        onTranscript(text) {
          if (current !== session) return;
          // Collected until the second tap; the whole utterance is interpreted in onComplete.
          session.transcript = `${session.transcript} ${text}`.replace(/\s+/g, ' ').trim();
        },
        onComplete() {
          if (current !== session || session.listening) return;
          const { transcript } = session;
          const kind = commandFromTranscript(transcript);
          current = undefined;
          close(session);
          options.status('idle');
          if (kind) options.bus.emit('voiceCommand', { kind, transcript });
          else if (transcript)
            options.bus.emit('voiceQuery', {
              id: `query-${++queries}`,
              transcript,
              tripMs: options.clock.nowMs(),
            });
        },
        onError: () => fail(session),
      });
      if (current !== session) {
        ink.cancel();
        return;
      }
      session.ink = ink;
      for (const samples of session.pending) send(session, samples);
      session.pending = [];
      session.pendingSamples = 0;
      if (!session.listening) {
        // The window ended while Ink was connecting: finalize what was buffered.
        report(session);
        options.status('transcribing');
        ink.finish();
      }
    } catch {
      fail(session);
    }
  }

  return {
    // First tap starts listening; a tap while listening finalizes early.
    toggle() {
      const session = current;
      if (session?.listening) finish(session);
      else void start();
    },
    start,
    finish() {
      if (current) finish(current);
    },
    cancel,
  };
}
