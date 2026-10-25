// Large-type caption of the line being spoken, so every spoken line is also readable. Set on
// `speak`, held briefly after its `speechEnded`, replaced by the next line, cleared on reset.
import { useEffect, useState } from 'react';
import type { Bus } from '../../../shared/types.ts';

const HOLD_MS = 1500;

type Caption = { id: string; text: string; urgent: boolean };

export function Captions({ bus }: { bus: Bus }) {
  const [caption, setCaption] = useState<Caption>();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearIf = (id?: string) =>
      setCaption((current) => (id === undefined || current?.id === id ? undefined : current));
    const offs = [
      bus.on('speak', ({ id, text, priority }) => {
        clearTimeout(timer);
        setCaption({ id, text, urgent: priority === 0 });
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

  return (
    <div className={`captions${caption?.urgent ? ' captions-urgent' : ''}`} aria-live="polite">
      {caption ? (
        <>
          <span className="caption-tag">{caption.urgent ? 'Warning' : 'Reminder'}</span>
          <p className="caption-line">{caption.text}</p>
        </>
      ) : (
        <p className="caption-empty">Spoken lines appear here.</p>
      )}
    </div>
  );
}
