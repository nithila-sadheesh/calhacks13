// App entry. Creates the one bus, picks real or mock modules (`?mock=map,vision,voice,arbiter`,
// any subset), turns on the debug event log, and mounts the UI. The UI starts the modules once
// the drive screen's <video> exists.
import { createRoot } from 'react-dom/client';
import { createBus } from '../../shared/bus.ts';
import { log } from '../../shared/log.ts';
import { mockFactories } from '../../shared/mocks/index.ts';
import type { AppModule } from '../../shared/types.ts';
import { arbiterModule, createArbiter } from './arbiter/index.ts';
import { mapModule } from './map/index.ts';
import { App } from './ui/App.tsx';
import './ui/styles.css';
import { visionModule } from './vision/index.ts';
import { voiceModule } from './voice/index.ts';

const mocked = new Set(new URLSearchParams(location.search).get('mock')?.split(',') ?? []);
const real: AppModule[] = [
  mapModule,
  visionModule,
  voiceModule,
  new URLSearchParams(location.search).get('mapSpeech') === '1' ? createArbiter() : arbiterModule,
];
const modules = real.map((m) => (mocked.has(m.name) ? mockFactories[m.name]() : m));

const bus = createBus();
// position arrives at ~10 Hz and would drown out everything else.
bus.onAny((type, payload) => type !== 'position' && log('bus', type, payload));

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(<App bus={bus} modules={modules} />);
