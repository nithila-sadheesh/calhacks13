// Top-level screen switch: the setup screen (with the supervisor check) first, then the drive.
import { useState } from 'react';
import type { AppModule, Bus } from '../../../shared/types.ts';
import { Drive } from './Drive.tsx';

export type AppProps = { bus: Bus; modules: AppModule[] };

export function App({ bus, modules }: AppProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [started, setStarted] = useState(false);

  if (started) return <Drive bus={bus} modules={modules} />;

  return (
    <main className="setup">
      <h1>Learner Co-Pilot</h1>
      <p className="lede">
        Supervised practice only. A licensed driver supervises; this is not automated driving or a
        navigation system.
      </p>
      <section className="panel">
        <h2>What leaves this device</h2>
        <ul className="privacy">
          <li>Sampled video frames are sent to Anthropic Claude for coaching.</li>
          <li>Spoken reminder text is sent to Cartesia Sonic.</li>
          <li>Microphone audio is sent to Cartesia Ink only while push-to-talk is held.</li>
          <li>
            GPS coordinates are not sent. Visible locations may be recognizable in video frames.
          </li>
        </ul>
      </section>
      <label className="check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        A licensed adult is in the passenger seat.
      </label>
      <button className="primary" disabled={!confirmed} onClick={() => setStarted(true)}>
        Load demo drive
      </button>
    </main>
  );
}
