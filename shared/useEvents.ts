// React hook for panels: every event of one type seen since the last tripReset, oldest first.
// Panels use it so they never keep state across a seek or restart.
import { useEffect, useState } from 'react';
import type { Bus, EventName, Events } from './types.ts';

export function useEvents<K extends EventName>(bus: Bus, type: K): Events[K][] {
  const [items, setItems] = useState<Events[K][]>([]);
  useEffect(() => {
    const offs = [
      bus.on(type, (payload) => setItems((prev) => [...prev, payload])),
      bus.on('tripReset', () => setItems([])),
    ];
    return () => offs.forEach((off) => off());
  }, [bus, type]);
  return items;
}
