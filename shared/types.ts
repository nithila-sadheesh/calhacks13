// FROZEN CONTRACT (docs/DESIGN.md, "Shared contracts"). Every event, fixture format and module
// interface lives here. Only Rohit edits this file, and only with team approval.

export type Position = {
  tripMs: number;
  lat: number;
  lon: number;
  speedMps: number;
  headingDeg: number;
  accuracyM?: number;
};

export type MapFeatureKind = 'turnLeft' | 'turnRight' | 'stopSign' | 'crosswalk' | 'signal';

export type MapCue = {
  id: string;
  featureId: string; // stable; one cue per feature per trip
  featureKind: MapFeatureKind;
  text: string; // safe template text, ready to speak
  reason: string; // e.g. 'stop sign 74 m ahead at 9 m/s'
  priority: 1 | 2; // 1 = timely coaching, 2 = optional advisory
  earliestMs: number;
  expiresMs: number;
};

export type WebcamAlert = {
  id: string;
  kind: 'pedestrianNearby' | 'followingDistance';
  text: string; // conservative wording; matches the clip
  reason: string; // e.g. 'person, conf 0.81, 4 of 5 frames, center region'
  confidence: number;
  tripMs: number;
  expiresMs: number;
  clipKey: string; // key in fixtures/audio/manifest.json
};

export type SpeakRequest = {
  id: string;
  sourceId: string; // the MapCue/WebcamAlert id, for the timeline
  text: string; // always present: shown as a caption
  clipKey?: string; // play a bundled clip instead of streaming
  fallbackClipKey?: string; // bundled clip to play if streaming fails or is slow
  priority: 0 | 1 | 2; // 0 = vision warning, interrupts
  expiresMs?: number;
};

export type ArbiterDecision = {
  sourceId: string;
  action: 'queued' | 'spoken' | 'interrupted' | 'dropped' | 'coalesced';
  reason: string; // e.g. 'expired', 'cooldown', 'preempted by alert'
  tripMs: number;
  speakId?: string; // the SpeakRequest id, on 'spoken' and 'interrupted'
};

export type DataSent = {
  destination: 'cartesia-tts' | 'cartesia-stt';
  summary: string; // e.g. 'text: "Stop sign ahead..."' or 'mic audio, 2.1 s'
  tripMs: number;
};

// The comment after each event names its only publisher. Anyone may subscribe.
export type Events = {
  position: Position; // Jeev
  mapCue: MapCue; // Jeev
  webcamAlert: WebcamAlert; // Tejas
  cameraHealth: { ok: boolean; reason?: string }; // Tejas
  speak: SpeakRequest; // Rohit
  arbiterDecision: ArbiterDecision; // Rohit
  tripState: { state: 'idle' | 'playing' | 'paused' | 'ended' }; // Rohit
  tripReset: { tripMs: number }; // Rohit
  speechStarted: { id: string; firstAudibleMs: number }; // Nithila
  speechEnded: { id: string; interrupted: boolean }; // Nithila
  voiceCommand: { kind: 'repeat' | 'mute' | 'unmute'; transcript: string }; // Nithila
  dataSent: DataSent; // Nithila
};

export type EventName = keyof Events;

export type Bus = {
  emit<K extends EventName>(type: K, payload: Events[K]): void;
  on<K extends EventName>(type: K, cb: (payload: Events[K]) => void): () => void;
  // Every event, for the debug log and the mock switch. Not for module logic.
  onAny(cb: (type: EventName, payload: unknown) => void): () => void;
};

export type TripClock = {
  nowMs(): number; // video.currentTime x 1000; track.json already applies its sync offset
  onReset(cb: (tripMs: number) => void): () => void;
};

// Fixture formats (parsed JSON from fixtures/demo-drive). Owner: Jeev.
export type TrackPoint = {
  tMs: number;
  lat: number;
  lon: number;
  speedMps?: number;
  headingDeg?: number;
  accuracyM?: number;
};
export type Track = { syncOffsetMs: number; points: TrackPoint[] };

export type MapFeature = {
  id: string;
  kind: MapFeatureKind;
  lat: number;
  lon: number;
  routeDistM: number;
  street?: string;
  source: 'osm' | 'osrm' | 'curated';
  note?: string;
};

export type Route = { coordinates: Array<[lon: number, lat: number]> };

export type Fixtures = { track: Track; features: MapFeature[]; route: Route };

export type ModuleContext = {
  bus: Bus;
  clock: TripClock;
  video: HTMLVideoElement; // owned by Rohit; others read frames/time only
  fixtures: Fixtures;
};

export type AppModule = {
  name: 'map' | 'vision' | 'voice' | 'arbiter';
  start(ctx: ModuleContext): Promise<void>;
  stop(): void;
};

// Props for the three React slots Rohit's layout mounts (Tejas, Jeev, Nithila).
export type PanelProps = { ctx: ModuleContext };
