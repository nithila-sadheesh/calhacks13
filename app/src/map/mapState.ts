// The map module's latest snapshot, for UpcomingPanel. The panel mounts after start() and must not
// collect 10 Hz position events (docs/KNOWN_GAPS.md), so the module keeps this state and the
// panel reads it here. Only the map module writes it.
import { EMPTY_SNAPSHOT, type MapSnapshot } from './engine.ts';

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((cb) => cb());
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

export const mapState = createStore<MapSnapshot>(EMPTY_SNAPSHOT);
