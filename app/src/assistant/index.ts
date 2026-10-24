// The assistant module: the browser side of Claude. Answers free-form spoken requests
// (`voiceQuery` -> `assistantReply`) and words route reminders ahead of time (`featureAhead` ->
// `cueWording`), both through POST /api/assistant. It never speaks itself: the arbiter decides
// when anything is heard, and a template or fixed command always works without it.
// Publishes: assistantReply, cueWording, dataSent (destination 'claude'). Clears on tripReset.
import { log } from '../../../shared/log.ts';
import {
  parseAssistantResponse,
  type AssistantRequest,
  type AssistantResponse,
} from '../../../shared/assistant.ts';
import { isSafeToSpeak } from '../../../shared/safeWording.ts';
import type { AppModule, Events } from '../../../shared/types.ts';
import { buildContext, emptyMemory, remember, type AheadFeature, type Memory } from './context.ts';

export const UNAVAILABLE = "Sorry, I can't answer that right now.";
const ANSWER_TIMEOUT_MS = 10_000;
const CUE_TIMEOUT_MS = 8_000;

const FEATURE_NAMES = {
  turnLeft: 'left turn',
  turnRight: 'right turn',
  stopSign: 'stop sign',
  crosswalk: 'crosswalk',
  signal: 'traffic light',
} as const;

export function createAssistantModule(fetcher: typeof fetch = (...a) => fetch(...a)): AppModule {
  let stopRunning: (() => void) | undefined;

  return {
    name: 'assistant',
    async start({ bus, clock }) {
      stopRunning?.();
      let memory: Memory = emptyMemory();
      let requested = new Set<string>();
      let controller = new AbortController();
      let answers = 0;

      async function post(body: AssistantRequest, timeoutMs: number) {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
        const response = await fetcher('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
        if (!response.ok) return undefined;
        return parseAssistantResponse(await response.json());
      }

      async function answer(query: Events['voiceQuery']) {
        const mine = controller;
        bus.emit('dataSent', {
          destination: 'claude',
          summary: `question: "${query.transcript}"`,
          tripMs: clock.nowMs(),
        });
        let reply: AssistantResponse | undefined;
        try {
          reply = await post(
            {
              mode: 'answer',
              question: query.transcript,
              context: buildContext(memory, clock.nowMs()),
            },
            ANSWER_TIMEOUT_MS,
          );
        } catch (e: unknown) {
          if (mine.signal.aborted) return;
          log('assistant', 'answer failed', String(e));
        }
        if (mine !== controller) return;
        const event: Events['assistantReply'] = {
          id: `answer-${++answers}`,
          queryId: query.id,
          tripMs: clock.nowMs(),
        };
        if (reply?.action) event.action = reply.action;
        // The server already checked the wording; check again before anything can be spoken.
        if (reply?.text) event.text = isSafeToSpeak(reply.text) ? reply.text : UNAVAILABLE;
        // The driver asked out loud, so a failed or empty reply still gets an audible answer.
        if (!event.text && !event.action) event.text = UNAVAILABLE;
        bus.emit('assistantReply', event);
      }

      async function word(ahead: Events['featureAhead']) {
        const mine = controller;
        const name = FEATURE_NAMES[ahead.featureKind];
        bus.emit('dataSent', {
          destination: 'claude',
          summary: `reminder wording: ${ahead.street ? `${name} onto ${ahead.street}` : name}`,
          tripMs: clock.nowMs(),
        });
        try {
          const feature = ahead.street
            ? { kind: ahead.featureKind, street: ahead.street }
            : { kind: ahead.featureKind };
          const reply = await post(
            { mode: 'cue', feature, context: buildContext(memory, clock.nowMs()) },
            CUE_TIMEOUT_MS,
          );
          if (mine !== controller || !reply?.text || !isSafeToSpeak(reply.text)) return;
          bus.emit('cueWording', { featureId: ahead.featureId, text: reply.text });
        } catch (e: unknown) {
          // The map's template is spoken instead.
          if (!mine.signal.aborted) log('assistant', 'cue wording failed', String(e));
        }
      }

      const offs = [
        bus.on('position', (p) => {
          memory.speedMps = p.speedMps;
        }),
        bus.on('speak', (s) => {
          memory.lines = remember(memory.lines, { tripMs: clock.nowMs(), text: s.text });
        }),
        bus.on('webcamAlert', (a) => {
          memory.alerts = remember(memory.alerts, {
            tripMs: a.tripMs,
            kind: a.kind,
            reason: a.reason,
          });
        }),
        bus.on('mapCue', (c) => memory.ahead.delete(c.featureId)),
        bus.on('featureAhead', (a) => {
          const entry: AheadFeature = {
            kind: a.featureKind,
            distM: a.distM,
            speedMps: a.speedMps,
            tripMs: a.tripMs,
          };
          if (a.street) entry.street = a.street;
          memory.ahead.set(a.featureId, entry);
          if (requested.has(a.featureId)) return;
          requested.add(a.featureId);
          void word(a);
        }),
        bus.on('voiceCommand', ({ kind }) => {
          if (kind !== 'repeat') memory.muted = kind === 'mute';
        }),
        bus.on('assistantReply', ({ action }) => {
          if (action && action !== 'repeat') memory.muted = action === 'mute';
        }),
        bus.on('voiceQuery', (q) => void answer(q)),
        bus.on('tripReset', () => {
          controller.abort();
          controller = new AbortController();
          memory = emptyMemory();
          requested = new Set();
        }),
      ];
      log('assistant', 'started');

      stopRunning = () => {
        controller.abort();
        offs.forEach((off) => off());
        stopRunning = undefined;
      };
    },
    stop() {
      stopRunning?.();
    },
  };
}

export const assistantModule: AppModule = createAssistantModule();
