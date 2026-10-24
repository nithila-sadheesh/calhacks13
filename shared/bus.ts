// The typed event bus. All cross-module communication goes through one instance of this,
// created in main.tsx. Synchronous, in-process, no replay of past events.
import type { Bus, EventName } from './types.ts';

export function createBus(): Bus {
  const listeners = new Map<EventName, Set<(payload: unknown) => void>>();
  const anyListeners = new Set<(type: EventName, payload: unknown) => void>();

  return {
    emit(type, payload) {
      listeners.get(type)?.forEach((cb) => cb(payload));
      anyListeners.forEach((cb) => cb(type, payload));
    },
    on(type, cb) {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      // The map is keyed by name, so a listener only ever receives its own payload type.
      const handler = cb as (payload: unknown) => void;
      set.add(handler);
      return () => set.delete(handler);
    },
    onAny(cb) {
      anyListeners.add(cb);
      return () => anyListeners.delete(cb);
    },
  };
}
