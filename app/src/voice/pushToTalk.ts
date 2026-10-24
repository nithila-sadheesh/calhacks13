import type { Bus, TripClock } from '../../../shared/types.ts';
import { commandFromTranscript } from './pcm.ts';
import { openCapture, type CaptureSession } from './capture.ts';
import { openInk, type InkSession } from './ink.ts';

export type MicStatus = 'idle' | 'connecting' | 'listening' | 'transcribing' | 'error';
export function createPushToTalk(options: {
  bus: Bus;
  clock: TripClock;
  status: (status: MicStatus) => void;
  capture?: typeof openCapture;
  ink?: typeof openInk;
}) {
  type Session = {
    controller: AbortController;
    held: boolean;
    capture?: CaptureSession;
    ink?: InkSession;
    sentSamples: number;
    reported: boolean;
    transcript: string;
  };
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
  function cancel() {
    const session = current;
    current = undefined;
    if (session) {
      session.held = false;
      session.capture?.stop();
      report(session);
      session.controller.abort();
      session.ink?.cancel();
    }
    options.status('idle');
  }
  return {
    async press() {
      if (current?.held) return;
      cancel();
      const session: Session = {
        controller: new AbortController(),
        held: true,
        sentSamples: 0,
        reported: false,
        transcript: '',
      };
      current = session;
      options.status('connecting');
      try {
        const capture = await (options.capture ?? openCapture)((samples) => {
          if (current !== session || !session.held || !session.ink) return;
          try {
            session.ink.send(samples);
            session.sentSamples += samples.length;
          } catch {
            cancel();
            options.status('error');
          }
        }, session.controller.signal);
        session.capture = capture;
        if (current !== session || !session.held) {
          capture.stop();
          return;
        }
        const ink = await (options.ink ?? openInk)({
          sampleRate: capture.sampleRate,
          signal: session.controller.signal,
          onTranscript(text) {
            if (current !== session) return;
            session.transcript = `${session.transcript} ${text}`.trim();
            // Manual Ink may produce multiple final segments. Interpret the complete utterance
            // only after release (see onComplete), never intermediate mic speech.
          },
          onComplete() {
            if (current !== session || session.held) return;
            const kind = commandFromTranscript(session.transcript);
            current = undefined;
            session.controller.abort();
            session.ink?.cancel();
            options.status('idle');
            if (kind) options.bus.emit('voiceCommand', { kind, transcript: session.transcript });
          },
          onError() {
            if (current === session) {
              cancel();
              options.status('error');
            }
          },
        });
        session.ink = ink;
        if (current !== session || !session.held) {
          report(session);
          ink.cancel();
          return;
        }
        options.status('listening');
      } catch {
        if (current === session) {
          cancel();
          options.status('error');
        }
      }
    },
    release() {
      const session = current;
      if (!session || !session.held) return;
      session.held = false;
      session.capture?.stop();
      if (!session.ink) {
        cancel();
        return;
      }
      report(session);
      options.status('transcribing');
      session.ink.finish();
    },
    cancel,
  };
}
