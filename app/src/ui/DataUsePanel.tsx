// Live list of everything sent off the device (`dataSent` events) under the fixed privacy statement.
import { useEvents } from '../../../shared/useEvents.ts';
import type { Bus } from '../../../shared/types.ts';

const DESTINATIONS = { 'cartesia-tts': 'Sonic', 'cartesia-stt': 'Ink', claude: 'Claude' } as const;

export function DataUsePanel({ bus }: { bus: Bus }) {
  const sent = useEvents(bus, 'dataSent');
  return (
    <section className="panel" aria-label="Data use">
      <h2>Data use</h2>
      <p>
        Video: stays on this device. Location: not sent. Sent to Cartesia and Claude: the lines
        below.
      </p>
      {sent.length === 0 ? (
        <p className="muted">Nothing sent yet.</p>
      ) : (
        <ul className="data-rows">
          {sent.map((d, i) => (
            <li key={i} className="data-row">
              <span className="data-row-head">
                <span className="data-row-dest">{DESTINATIONS[d.destination]}</span>
                <span>{(d.tripMs / 1000).toFixed(1)} s</span>
              </span>
              <span>{d.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
