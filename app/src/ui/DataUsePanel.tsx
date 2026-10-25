// Live list of everything sent off the device (`dataSent` events) under the fixed privacy statement.
import { useEvents } from '../../../shared/useEvents.ts';
import type { Bus } from '../../../shared/types.ts';

const DESTINATIONS = {
  'cartesia-tts': 'Sonic',
  'cartesia-stt': 'Ink',
  claude: 'Claude conversation',
  'anthropic-vision': 'Claude vision coaching',
} as const;

export function DataUsePanel({ bus }: { bus: Bus }) {
  const sent = useEvents(bus, 'dataSent');
  return (
    <section className="panel" aria-label="Data use">
      <h2>Data use</h2>
      <p>
        Video frames stay on this device. Object descriptions, spoken questions and trip context go
        to Anthropic. GPS coordinates are not sent. Spoken text goes to Cartesia Sonic; microphone
        audio goes to Cartesia Ink while recording.
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
