import { parseCvScene, type CvScene } from './cvScene.js';
// Wire format between the browser's assistant module and POST /api/assistant. The browser sends a
// short trip summary: what was said, recent alerts, upcoming features by street and distance, and
// speed. Never video, images or GPS coordinates (AGENTS.md section 3 rule 9).
import { parseDelivery } from './delivery.js';
import type { Delivery, MapFeatureKind } from './types.ts';

export type TripContext = {
  localScene?: CvScene; // tentative image observations; never measured road geometry
  speedMps?: number;
  muted: boolean;
  recentLines: Array<{ agoS: number; text: string }>;
  recentAlerts: Array<{ agoS: number; kind: string; reason: string }>;
  upcoming: Array<{ kind: MapFeatureKind; street?: string; distM: number }>;
};

export type AssistantRequest =
  | { mode: 'answer'; question: string; context: TripContext }
  | { mode: 'cue'; feature: { kind: MapFeatureKind; street?: string }; context: TripContext };

export type AssistantAction = 'repeat' | 'mute' | 'unmute';
export type AssistantResponse = { text?: string; action?: AssistantAction; delivery?: Delivery };

export const MAX_QUESTION_CHARS = 500;
const KINDS: readonly MapFeatureKind[] = [
  'turnLeft',
  'turnRight',
  'stopSign',
  'crosswalk',
  'signal',
];
const ACTIONS: readonly AssistantAction[] = ['repeat', 'mute', 'unmute'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const kind = (v: unknown): MapFeatureKind | undefined => KINDS.find((k) => k === v);

// Keeps only well-formed entries and caps every list, so a request stays small and plain.
function parseContext(v: unknown): TripContext | undefined {
  if (!isRecord(v)) return undefined;
  const list = (x: unknown) => (Array.isArray(x) ? x.slice(-8) : []);
  const context: TripContext = {
    muted: v.muted === true,
    recentLines: list(v.recentLines).flatMap((l) => {
      const text = isRecord(l) ? str(l.text, 300) : undefined;
      const agoS = isRecord(l) ? num(l.agoS) : undefined;
      return text !== undefined && agoS !== undefined ? [{ agoS, text }] : [];
    }),
    recentAlerts: list(v.recentAlerts).flatMap((a) => {
      if (!isRecord(a)) return [];
      const k = str(a.kind, 40);
      const reason = str(a.reason, 200);
      const agoS = num(a.agoS);
      return k && reason && agoS !== undefined ? [{ agoS, kind: k, reason }] : [];
    }),
    upcoming: list(v.upcoming).flatMap((f) => {
      if (!isRecord(f)) return [];
      const k = kind(f.kind);
      const distM = num(f.distM);
      const street = str(f.street, 100);
      if (!k || distM === undefined) return [];
      return [street ? { kind: k, street, distM } : { kind: k, distM }];
    }),
  };
  if (v.localScene !== undefined) {
    const scene = parseCvScene(v.localScene);
    if (!scene) return undefined;
    context.localScene = scene;
  }
  const speed = num(v.speedMps);
  if (speed !== undefined) context.speedMps = speed;
  return context;
}

export function parseAssistantRequest(v: unknown): AssistantRequest | undefined {
  if (!isRecord(v)) return undefined;
  const context = parseContext(v.context);
  if (!context) return undefined;
  if (v.mode === 'answer') {
    const question = str(v.question, MAX_QUESTION_CHARS);
    return question ? { mode: 'answer', question, context } : undefined;
  }
  if (v.mode === 'cue' && isRecord(v.feature)) {
    const k = kind(v.feature.kind);
    if (!k) return undefined;
    const street = str(v.feature.street, 100);
    return { mode: 'cue', feature: street ? { kind: k, street } : { kind: k }, context };
  }
  return undefined;
}

export function parseAssistantResponse(v: unknown): AssistantResponse | undefined {
  if (!isRecord(v)) return undefined;
  const response: AssistantResponse = {};
  const text = str(v.text, 400);
  if (text) response.text = text;
  const action = ACTIONS.find((a) => a === v.action);
  if (action) response.action = action;
  // A delivery means nothing without the words it shapes.
  const delivery = text ? parseDelivery(v.delivery) : undefined;
  if (delivery) response.delivery = delivery;
  return response.text || response.action ? response : undefined;
}
