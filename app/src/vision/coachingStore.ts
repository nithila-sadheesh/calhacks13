export type CoachingSnapshot = {
  status: 'idle' | 'collecting' | 'analyzing' | 'ready' | 'error';
  message?: string;
  reason?: string;
  error?: string;
  latencyMs?: number;
  frameTripMs?: number;
};
const empty: CoachingSnapshot = { status: 'idle' };
let snapshot = empty;
const listeners = new Set<() => void>();
export const coachingStore = {
  get: () => snapshot,
  set(next: CoachingSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  },
  reset() {
    this.set(empty);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
