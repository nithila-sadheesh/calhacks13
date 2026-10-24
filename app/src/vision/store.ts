// A tiny in-module store the frame loop writes and VisionOverlay reads. Detections run at ~8 Hz,
// too fast and too detailed for the bus, and only the overlay (in this same folder) needs them,
// so they stay here rather than becoming an event (KNOWN_GAPS.md "keep it in your module").
import type { Box } from './geometry.ts';

export type OverlayDetection = {
  id: number;
  cls: string;
  score: number;
  box: Box; // normalized [0,1]
  inRegion: boolean;
};

export type VisionSnapshot = {
  detections: OverlayDetection[];
  alertTrackId: number | null; // the box behind the current alert, to highlight
  alertReason: string | null;
  health: { ok: boolean; reason?: string };
};

const EMPTY: VisionSnapshot = {
  detections: [],
  alertTrackId: null,
  alertReason: null,
  health: { ok: true },
};

let snapshot: VisionSnapshot = EMPTY;
const subscribers = new Set<() => void>();

export const visionStore = {
  get(): VisionSnapshot {
    return snapshot;
  },
  set(next: VisionSnapshot): void {
    snapshot = next;
    for (const cb of subscribers) cb();
  },
  reset(): void {
    this.set(EMPTY);
  },
  subscribe(cb: () => void): () => void {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },
};
