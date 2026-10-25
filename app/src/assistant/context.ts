import type { CvScene } from '../../../shared/cvScene.ts';
// The trip summary sent with every Claude request, built from bus events. Pure, so the exact
// payload (and what it leaves out: video, images, coordinates) is unit-tested.
import type { TripContext } from '../../../shared/assistant.ts';
import type { MapFeatureKind } from '../../../shared/types.ts';

export const KEEP = 6;
const MAX_AGE_MS = 120_000;

export type AheadFeature = {
  kind: MapFeatureKind;
  street?: string;
  distM: number;
  speedMps: number;
  tripMs: number;
};

export type Memory = {
  localScene?: CvScene;
  speedMps?: number;
  muted: boolean;
  lines: Array<{ tripMs: number; text: string }>;
  alerts: Array<{ tripMs: number; kind: string; reason: string }>;
  ahead: Map<string, AheadFeature>;
};

export const emptyMemory = (): Memory => ({
  muted: false,
  lines: [],
  alerts: [],
  ahead: new Map(),
});

export function remember<T extends { tripMs: number }>(list: T[], item: T): T[] {
  return [...list, item].slice(-KEEP);
}

const agoS = (nowMs: number, tripMs: number) => Math.max(0, Math.round((nowMs - tripMs) / 1000));

export function buildContext(memory: Memory, nowMs: number): TripContext {
  const recent = <T extends { tripMs: number }>(list: T[]) =>
    list.filter((x) => nowMs - x.tripMs <= MAX_AGE_MS);
  // Features were announced some seconds ago; estimate how far they are now from the speed then.
  const upcoming = [...memory.ahead.values()]
    .map((f) => ({ ...f, distM: f.distM - (f.speedMps * Math.max(0, nowMs - f.tripMs)) / 1000 }))
    .filter((f) => f.distM > 0)
    .sort((a, b) => a.distM - b.distM)
    .slice(0, 3)
    .map(({ kind, street, distM }) =>
      street ? { kind, street, distM: Math.round(distM) } : { kind, distM: Math.round(distM) },
    );
  const context: TripContext = {
    muted: memory.muted,
    recentLines: recent(memory.lines).map((l) => ({ agoS: agoS(nowMs, l.tripMs), text: l.text })),
    recentAlerts: recent(memory.alerts).map((a) => ({
      agoS: agoS(nowMs, a.tripMs),
      kind: a.kind,
      reason: a.reason,
    })),
    upcoming,
  };
  if (
    memory.localScene &&
    nowMs >= memory.localScene.tripMs &&
    nowMs - memory.localScene.tripMs <= 3000
  )
    context.localScene = memory.localScene;
  if (memory.speedMps !== undefined) context.speedMps = Math.round(memory.speedMps * 10) / 10;
  return context;
}
