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
      <p>Supervised practice only. This is not automated driving or a navigation system.</p>
      <p>
        Video is analysed on this device and never uploaded. The microphone is used only while
        push-to-talk is held.
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{' '}
        A licensed adult is in the passenger seat.
      </label>
      <button disabled={!confirmed} onClick={() => setStarted(true)}>
        Load demo drive
      </button>
    </main>
  );
}
