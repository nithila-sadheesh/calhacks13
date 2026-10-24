// Live list of everything sent to Cartesia (`dataSent` events) under the fixed privacy statement.
import { useEvents } from '../../../shared/useEvents.ts';
import type { Bus } from '../../../shared/types.ts';

export function DataUsePanel({ bus }: { bus: Bus }) {
  const sent = useEvents(bus, 'dataSent');
  return (
    <section className="panel">
      <h2>Data use</h2>
      <p>Video: stays on this device. Location: not sent. Sent to Cartesia: the lines below.</p>
      <ul>
        {sent.map((d, i) => (
          <li key={i}>
            {d.destination}: {d.summary}
          </li>
        ))}
      </ul>
    </section>
  );
}
