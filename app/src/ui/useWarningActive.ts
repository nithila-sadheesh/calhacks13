// Tracks whether a vision warning (priority-0 speak) is currently active, held briefly after it
// finishes, so the camera frame and status strip light up in sync with the voice and caption.
// Mirrors the Captions subscription pattern; clears on tripReset.
import { useEffect, useState } from 'react';
import type { Bus } from '../../../shared/types.ts';

const HOLD_MS = 1500;

export function useWarningActive(bus: Bus): string | null {
  const [warning, setWarning] = useState<{ id: string; text: string }>();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearIf = (id?: string) =>
      setWarning((current) => (id === undefined || current?.id === id ? undefined : current));
    const offs = [
      bus.on('speak', ({ id, text, priority }) => {
        if (priority !== 0) return;
        clearTimeout(timer);
        setWarning({ id, text });
      }),
      bus.on('speechEnded', ({ id }) => {
        clearTimeout(timer);
        timer = setTimeout(() => clearIf(id), HOLD_MS);
      }),
      bus.on('tripReset', () => {
        clearTimeout(timer);
        clearIf();
      }),
    ];
    return () => {
      clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, [bus]);

  return warning?.text ?? null;
}
