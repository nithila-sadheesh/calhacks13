import { createBus } from '../../../shared/bus.ts';
import { commandFromTranscript, decodePcm, encodePcm } from './pcm.ts';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing ${id}`);
  return node as T;
}
const bus = createBus();
bus.on('dataSent', (event) => report(`${event.destination}: ${event.summary}`));
const status = element('status');
const caption = element('caption');
const prepare = element<HTMLButtonElement>('prepare');
const speak = element<HTMLButtonElement>('speak');
const interrupt = element<HTMLButtonElement>('interrupt');
const talk = element<HTMLButtonElement>('talk');
const transcript = element('transcript');
const audio = new AudioContext();
const sources = new Set<AudioBufferSourceNode>();
let socket: WebSocket | undefined;
let activeId: string | undefined;
let warning: Float32Array | undefined;
let nextTime = 0;
let generation = 0;
const rate = 24000;
const voice = 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4';
const warningText = 'Pedestrian ahead. Stay alert.';
const reminder = 'Right turn ahead onto University Avenue. Check your mirror and blind spot.';
function report(message: string) {
  status.textContent = `${message}\n${status.textContent}`;
}
function run(action: () => Promise<void>) {
  void action().catch((error: unknown) =>
    report(error instanceof Error ? error.message : 'Voice test failed.'),
  );
}
async function connect(path: string, extra: Record<string, string> = {}): Promise<WebSocket> {
  const response = await fetch('/api/cartesia-token');
  if (!response.ok) {
    const detail =
      response.status === 503
        ? 'API key is missing. Add it to .env and restart the spike server.'
        : response.status === 401
          ? 'Cartesia rejected token authentication (HTTP 401). Run the checkAuth diagnostic.'
          : response.status === 402
            ? 'Cartesia requires credits or billing setup.'
            : response.status === 429
              ? 'Cartesia rate limit reached. Wait and try again.'
              : response.status === 404
                ? 'Token route missing. Start scripts/voice/spikeServer.ts, not npm run dev.'
                : `Token request failed (HTTP ${response.status}). Check the spike-server terminal.`;
    throw new Error(detail);
  }
  const body = (await response.json()) as { token: string };
  const params = new URLSearchParams({
    access_token: body.token,
    cartesia_version: '2026-08-14',
    ...extra,
  });
  const ws = new WebSocket(`wss://api.cartesia.ai/${path}?${params}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(
        new Error(
          'Cartesia WebSocket connection failed. Check your network and browser connection restrictions.',
        ),
      );
    };
    ws.onclose = (event) => {
      clearTimeout(timer);
      reject(new Error(`Cartesia connection closed before opening (code ${event.code}).`));
    };
  });
  return ws;
}
function request(ws: WebSocket, id: string, text: string) {
  bus.emit('dataSent', { destination: 'cartesia-tts', summary: `text: ${text}`, tripMs: 0 });
  ws.send(
    JSON.stringify({
      model_id: 'sonic-3.6',
      voice,
      language: 'en',
      transcript: text,
      context_id: id,
      continue: false,
      max_buffer_delay_ms: 0,
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: rate },
    }),
  );
}
function stopAudio() {
  activeId = undefined; // Invalidate first, so late chunks can never restart the old request.
  generation++;
  for (const source of sources) {
    source.stop();
    source.disconnect();
  }
  sources.clear();
  nextTime = audio.currentTime;
}
function schedule(samples: Float32Array) {
  const buffer = audio.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(Float32Array.from(samples), 0);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  const when = Math.max(audio.currentTime + 0.02, nextTime);
  sources.add(source);
  source.onended = () => {
    sources.delete(source);
    source.disconnect();
  };
  source.start(when);
  nextTime = when + buffer.duration;
}
prepare.onclick = () =>
  run(async () => {
    prepare.disabled = true;
    try {
      await audio.resume();
      const ws = await connect('tts/websocket');
      const id = crypto.randomUUID();
      const chunks: Float32Array[] = [];
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('Generation timeout'));
        }, 15000);
        const finish = (error?: Error) => {
          clearTimeout(timer);
          ws.close();
          if (error) reject(error);
          else resolve();
        };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data));
            if (msg.type === 'error') {
              const code =
                typeof msg.error_code === 'string' && /^[a-z_]+$/.test(msg.error_code)
                  ? msg.error_code
                  : 'request_rejected';
              finish(
                new Error(
                  `Sonic rejected warning generation (${code}, status ${Number(msg.status_code) || 'unknown'}).`,
                ),
              );
              return;
            }
            if (msg.context_id !== id) return;
            if (msg.type === 'chunk') chunks.push(decodePcm(msg.data));
            if (msg.type === 'done') finish();
          } catch {
            finish(new Error('Invalid audio'));
          }
        };
        ws.onerror = () => finish(new Error('Sonic connection failed during warning generation.'));
        ws.onclose = (event) =>
          finish(new Error(`Sonic closed before completing the warning (code ${event.code}).`));
        request(ws, id, warningText);
      });
      warning = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        warning.set(chunk, offset);
        offset += chunk.length;
      }
      if (!warning.length) throw new Error('No warning audio');
      speak.disabled = false;
      interrupt.disabled = false;
      report('Warning loaded into memory. Streaming a reminder can now be interrupted locally.');
    } finally {
      prepare.disabled = false;
    }
  });
speak.onclick = () =>
  run(async () => {
    speak.disabled = true;
    try {
      stopAudio();
      socket?.close();
      const mine = generation;
      await audio.resume();
      socket = await connect('tts/websocket');
      if (mine !== generation) {
        socket.close();
        return;
      }
      const id = crypto.randomUUID();
      activeId = id;
      caption.textContent = reminder;
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.context_id !== activeId) return;
          if (msg.type === 'chunk') schedule(decodePcm(msg.data));
          if (msg.type === 'error') {
            stopAudio();
            report('Sonic rejected the request.');
          }
        } catch {
          stopAudio();
          report('Invalid Sonic response.');
        }
      };
      socket.onerror = () => {
        stopAudio();
        report('Sonic connection failed.');
      };
      request(socket, id, reminder);
    } finally {
      speak.disabled = false;
    }
  });
interrupt.onclick = () =>
  run(async () => {
    if (!warning) return;
    const old = activeId;
    stopAudio();
    if (old && socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ context_id: old, cancel: true }));
    await audio.resume();
    schedule(warning);
    caption.textContent = warningText;
    report(
      'Stopped scheduled audio, invalidated late chunks, and played the local warning. Listen for overlap.',
    );
  });
let held = false;
let mic: MediaStream | undefined;
let micContext: AudioContext | undefined;
let micSocket: WebSocket | undefined;
let micNode: ScriptProcessorNode | undefined;
let micSource: MediaStreamAudioSourceNode | undefined;
let sentSamples = 0;
let session = 0;
function release() {
  held = false;
  session++;
  micNode?.disconnect();
  micSource?.disconnect();
  mic?.getTracks().forEach((track) => track.stop());
  void micContext?.close();
  micNode = undefined;
  micSource = undefined;
  mic = undefined;
  micContext = undefined;
  if (micSocket?.readyState === WebSocket.OPEN) {
    bus.emit('dataSent', {
      destination: 'cartesia-stt',
      summary: `mic audio, ${(sentSamples / 48000).toFixed(2)} s`,
      tripMs: 0,
    });
    const ws = micSocket;
    ws.send('finalize');
    setTimeout(() => ws.close(), 5000);
  }
  micSocket = undefined;
  talk.textContent = 'Hold to talk (or hold Space when focused)';
}
async function listen() {
  if (held) return;
  held = true;
  const mine = ++session;
  sentSamples = 0;
  talk.textContent = 'Connecting microphone… keep holding';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!held || mine !== session) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    mic = stream;
    const ws = await connect('stt/websocket', {
      model: 'ink-2',
      encoding: 'pcm_s16le',
      sample_rate: '48000',
      language: 'en',
    });
    if (!held || mine !== session) {
      ws.close();
      return;
    }
    micSocket = ws;
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type === 'transcript' && msg.is_final) {
        const command = commandFromTranscript(msg.text);
        transcript.textContent = `Transcript: ${msg.text}${command ? ` — command: ${command}` : ' — no supported command'}`;
        if (command) bus.emit('voiceCommand', { kind: command, transcript: msg.text });
      }
      if (msg.type === 'flush_done') ws.send('close');
      if (msg.type === 'done') ws.close();
      if (msg.type === 'error') {
        report('Ink rejected the session.');
        if (mine === session) release();
        ws.close();
      }
    };
    ws.onerror = () => {
      report('Ink connection failed.');
      if (mine === session) release();
    };
    ws.onclose = () => {
      if (mine === session && held) release();
    };
    micContext = new AudioContext({ sampleRate: 48000 });
    await micContext.resume();
    if (!held || mine !== session) return;
    micSource = micContext.createMediaStreamSource(stream);
    // Spike only: replace the deprecated processor with an AudioWorklet for integration.
    micNode = micContext.createScriptProcessor(4096, 1, 1);
    micNode.onaudioprocess = (event) => {
      if (!held || mine !== session || ws.readyState !== WebSocket.OPEN) return;
      const samples = event.inputBuffer.getChannelData(0);
      ws.send(encodePcm(samples));
      sentSamples += samples.length;
    };
    micSource.connect(micNode);
    micNode.connect(micContext.destination);
    talk.textContent = 'Listening… release to transcribe';
  } catch {
    if (mine === session) release();
    report('Microphone or Ink connection failed.');
  }
}
talk.onpointerdown = (event) => {
  if (event.button !== 0) return;
  talk.setPointerCapture(event.pointerId);
  run(listen);
};
talk.style.touchAction = 'none';
talk.onpointerup = release;
talk.onpointercancel = release;
talk.onlostpointercapture = () => {
  if (held) release();
};
talk.onkeydown = (event) => {
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault();
    run(listen);
  }
};
talk.onkeyup = (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    release();
  }
};
window.addEventListener('blur', () => {
  if (held) release();
});
window.addEventListener('pagehide', () => {
  release();
  stopAudio();
  socket?.close();
  void audio.close();
});
