// Large-type caption of the current spoken line, so every spoken line is also readable.
import { useEvents } from '../../../shared/useEvents.ts';
import type { Bus } from '../../../shared/types.ts';

export function Captions({ bus }: { bus: Bus }) {
  const last = useEvents(bus, 'speak').at(-1);
  return (
    <p className="captions" aria-live="polite">
      {last?.text ?? ''}
    </p>
  );
}
