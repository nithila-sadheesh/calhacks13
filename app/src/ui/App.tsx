// Top-level screen switch: the setup screen (with the supervisor check) first, then the drive,
// either live from this device's camera and GPS or the recorded demo drive.
import { useState } from 'react';
import type { AppModule, Bus, TripSource } from '../../../shared/types.ts';
import { Drive } from './Drive.tsx';

export type AppProps = { bus: Bus; modules: AppModule[] };

export function App({ bus, modules }: AppProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [source, setSource] = useState<TripSource>();

  if (source) return <Drive bus={bus} modules={modules} source={source} />;

  return (
    <main className="setup">
      <h1>Voya</h1>
      <p className="lede">
        Supervised practice only. A licensed driver supervises; this is not automated driving or a
        navigation system.
      </p>
      <section className="panel">
        <h2>What leaves this device</h2>
        <ul className="privacy">
          <li>Video frames stay on the device.</li>
          <li>Spoken reminder text is sent to Cartesia Sonic.</li>
          <li>
            Microphone audio is sent to Cartesia Ink only between your two taps of the talk button.
          </li>
          <li>
            Your spoken questions and a short trip summary (recent reminders, upcoming streets,
            speed) are sent to Claude. Never video or GPS coordinates.
          </li>
          <li>Location is used on this device to time route reminders and is never sent.</li>
        </ul>
      </section>
      <section className="panel">
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          A licensed adult is in the passenger seat.
        </label>
      </section>
      <div className="actions">
        <button className="primary" disabled={!confirmed} onClick={() => setSource('live')}>
          Start live drive
        </button>
        <button className="secondary" disabled={!confirmed} onClick={() => setSource('replay')}>
          Load demo drive
        </button>
      </div>
      <p className="muted">
        Live uses this device&apos;s rear camera to spot pedestrians and its location to time route
        reminders. The microphone records only between your two taps of the talk button.
      </p>
    </main>
  );
}
