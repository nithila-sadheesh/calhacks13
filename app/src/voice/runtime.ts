import { createPushToTalk } from './pushToTalk.ts';
import { createBus } from '../../../shared/bus.ts';
import { loadClips } from './clips.ts';
import { CLIP_TEXT } from './config.ts';
import { createVoiceEngine } from './engine.ts';
import { createAudioPlayer } from './player.ts';
import { createSonicTransport } from './sonic.ts';
function node<T extends HTMLElement>(id: string): T {
  const item = document.getElementById(id);
  if (!item) throw new Error(`Missing ${id}`);
  return item as T;
}
const output = node('log');
const report = (message: string) => {
  output.textContent = `${message}\n${output.textContent}`;
};
const bus = createBus();
bus.onAny((type, payload) => report(`${type}: ${JSON.stringify(payload)}`));
const player = createAudioPlayer();
const clips = await loadClips(AbortSignal.timeout(10000)).catch(() => new Map());
node('ready').textContent =
  `${clips.size}/6 bundled clips loaded.${clips.size < 6 ? ' Run npm run clips and refresh.' : ''}`;
const engine = createVoiceEngine({
  bus,
  clock: { nowMs: () => 0, onReset: () => () => {} },
  player,
  clips,
  transport: (receive, disconnect) =>
    createSonicTransport(receive, disconnect, (text) =>
      bus.emit('dataSent', { destination: 'cartesia-tts', summary: `text: "${text}"`, tripMs: 0 }),
    ),
});
node<HTMLButtonElement>('enable').onclick = () => {
  void player
    .enable()
    .then(() => {
      node<HTMLButtonElement>('route').disabled = false;
      node<HTMLButtonElement>('warning').disabled = !clips.has('pedestrianNearby');
      node<HTMLButtonElement>('reset').disabled = false;
      report('Sound enabled.');
    })
    .catch(() => report('Sound could not be enabled.'));
};
node<HTMLButtonElement>('route').onclick = () =>
  engine.speak({
    id: crypto.randomUUID(),
    sourceId: 'manual-route',
    priority: 1,
    text: 'Right turn ahead onto University Avenue. Check your mirror and blind spot.',
  });
node<HTMLButtonElement>('warning').onclick = () =>
  engine.speak({
    id: crypto.randomUUID(),
    sourceId: 'manual-warning',
    priority: 0,
    text: CLIP_TEXT.pedestrianNearby,
    clipKey: 'pedestrianNearby',
  });
node<HTMLButtonElement>('reset').onclick = () => {
  engine.reset();
  mic.cancel();
};
const mic = createPushToTalk({
  bus,
  clock: { nowMs: () => 0, onReset: () => () => {} },
  status: (status) => {
    node('mic').textContent = `Microphone: ${status}`;
  },
});
const talk = node<HTMLButtonElement>('talk');
talk.onclick = () => mic.toggle();
window.addEventListener('blur', () => mic.cancel());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) mic.cancel();
});
bus.on('speechStarted', (event) => {
  node('latency').textContent = `First audible: ${Math.round(event.firstAudibleMs)} ms`;
});
window.addEventListener('pagehide', () => {
  mic.cancel();
  engine.stop();
});
