// The drive screen layout and module startup. Owns the one <video> element.
// Phase 1 (once the <video> exists): load fixtures and build the trip clock and context. Replay
// plays the recorded drive; live feeds the rear camera into the same <video>.
// Phase 2 (once the context is rendered): start every module. Child effects run before parent
// effects, so every panel has subscribed to the bus before any module's start() can emit.
// Slots: VisionOverlay over the video; VoicePanel (first, so the microphone sits right under the
// captions on a phone) and UpcomingPanel in the side panel.
import { useEffect, useRef, useState } from 'react';
import type { AppModule, Bus, ModuleContext, TripSource } from '../../../shared/types.ts';
import { UpcomingPanel } from '../map/UpcomingPanel.tsx';
import { holdWakeLock, openCamera } from '../replay/camera.ts';
import { createLive } from '../replay/live.ts';
import { createReplay } from '../replay/replay.ts';
import { loadFixtures } from '../replay/fixtures.ts';
import { VisionOverlay } from '../vision/VisionOverlay.tsx';
import { voiceModule } from '../voice/index.ts';
import { VoicePanel } from '../voice/VoicePanel.tsx';
import { Assistant } from './Assistant.tsx';
import { Captions } from './Captions.tsx';
import { DataUsePanel } from './DataUsePanel.tsx';
import { MicOrb } from './MicOrb.tsx';
import { StatusStrip } from './StatusStrip.tsx';
import { Timeline } from './Timeline.tsx';
import { useWarningActive } from './useWarningActive.ts';

type DriveProps = { bus: Bus; modules: AppModule[]; source: TripSource };
type Live = ReturnType<typeof createLive>;
type Session = { ctx: ModuleContext; announce: () => void; live?: Live };

export function Drive({ bus, modules, source }: DriveProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const releaseRef = useRef<() => void>(undefined);
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [trip, setTrip] = useState<'idle' | 'starting' | 'running'>('idle');
  // The overlay draws in the video box's coordinates, so the box takes the video's shape.
  const [aspect, setAspect] = useState(16 / 9);
  const realVoice = modules.includes(voiceModule);
  const canPlay = ready && (!realVoice || soundEnabled);
  const warning = useWarningActive(bus);
  const warningShort = warning ? (warning.split('.')[0] ?? warning) : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;

    loadFixtures()
      .then((fixtures) => {
        if (cancelled) return;
        if (source === 'live') {
          const live = createLive(video, bus);
          dispose = live.dispose;
          setSession({
            ctx: { source, bus, clock: live.clock, video, fixtures },
            announce: live.announce,
            live,
          });
        } else {
          const replay = createReplay(video, bus);
          dispose = replay.dispose;
          setSession({
            ctx: { source, bus, clock: replay.clock, video, fixtures },
            announce: replay.announce,
          });
        }
      })
      .catch((e: unknown) => setError(String(e)));

    return () => {
      cancelled = true;
      dispose?.();
      releaseRef.current?.();
      releaseRef.current = undefined;
    };
  }, [bus, source]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    Promise.all(modules.map((m) => m.start(session.ctx)))
      .then(() => {
        // Unmounted while starting: the cleanup's stop() ran too early, so stop again.
        if (cancelled) modules.forEach((m) => m.stop());
        else {
          session.announce();
          setReady(true);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        modules.forEach((m) => m.stop());
        setError(`A module failed to start: ${String(e)}`);
      });

    return () => {
      cancelled = true;
      modules.forEach((m) => m.stop());
    };
  }, [session, modules]);

  const startLive = async () => {
    const video = videoRef.current;
    const live = session?.live;
    if (!video || !live) return;
    setTrip('starting');
    setError(undefined);
    try {
      // Unlock audio first, while still inside the tap: iOS refuses it after an await.
      const sound = realVoice ? voiceModule.enableAudio() : Promise.resolve();
      sound.catch(() => {}); // still awaited below; this only stops an early camera error leaving it unhandled
      const closeCamera = await openCamera(video);
      const releaseWake = holdWakeLock();
      releaseRef.current = () => {
        releaseWake();
        closeCamera();
      };
      await sound;
      live.start();
      setTrip('running');
    } catch (e: unknown) {
      releaseRef.current?.();
      releaseRef.current = undefined;
      setError(cameraError(e));
      setTrip('idle');
    }
  };

  const endLive = () => {
    session?.live?.end();
    releaseRef.current?.();
    releaseRef.current = undefined;
    setTrip('idle');
  };

  const ctx = session?.ctx;
  const live = source === 'live';
  const voiceActive = realVoice && (live ? trip === 'running' : canPlay);
  return (
    <main className="drive">
      <section className="stage">
        {/* Capped at 70% of the screen height so portrait video leaves room for captions. */}
        <div
          className={`video-wrap${warning ? ' is-warning' : ''}`}
          style={{ aspectRatio: aspect, maxWidth: `min(100%, calc(70svh * ${aspect}))` }}
        >
          <video
            ref={videoRef}
            src={live ? undefined : '/demo-drive/video.mp4'}
            controls={!live && canPlay}
            onPlay={() => {
              if (!live && !canPlay) videoRef.current?.pause();
            }}
            onLoadedMetadata={(e) => {
              const shape = videoAspect(e.currentTarget);
              setAspect((a) => shape ?? a);
            }}
            onResize={(e) => {
              const shape = videoAspect(e.currentTarget);
              setAspect((a) => shape ?? a);
            }}
            controlsList="noplaybackrate nodownload"
            disablePictureInPicture
            muted
            playsInline
            onError={() =>
              !live && setError('Could not load the drive video (/demo-drive/video.mp4).')
            }
          />
          {ctx && <StatusStrip live={live} warning={warningShort} />}
          {ctx && <VisionOverlay ctx={ctx} />}
        </div>
        {!ready && !error && <p role="status">Loading drive modules…</p>}
        <Captions bus={bus} />
        <Assistant bus={bus} />
        {ready && live && trip !== 'running' && (
          <button
            type="button"
            className="primary trip-button"
            disabled={trip === 'starting'}
            onClick={() => void startLive()}
          >
            {trip === 'starting' ? 'Starting…' : 'Start drive'}
          </button>
        )}
        {ready && !live && realVoice && !soundEnabled && (
          <button
            type="button"
            className="secondary trip-button"
            onClick={() => {
              void voiceModule
                .enableAudio()
                .then(() => setSoundEnabled(true))
                .catch(() => setError('Could not enable sound. Try again.'));
            }}
          >
            Enable replay sound
          </button>
        )}
        {ctx && ready && realVoice && <MicOrb bus={bus} active={voiceActive} />}
        {live && trip === 'running' && (
          <button type="button" className="secondary trip-button" onClick={endLive}>
            End drive
          </button>
        )}
      </section>
      <aside className="side">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {ctx &&
          ready &&
          (realVoice ? (
            <VoicePanel ctx={ctx} />
          ) : (
            <section className="panel">
              <h2>Voice</h2>
              <p>Voice mock active. Audio and microphone are disabled.</p>
            </section>
          ))}
        {ctx && <UpcomingPanel ctx={ctx} />}
        <DataUsePanel bus={bus} />
      </aside>
      <details className="timeline-collapse">
        <summary>Timeline</summary>
        <Timeline bus={bus} />
      </details>
    </main>
  );
}

function videoAspect(video: HTMLVideoElement): number | undefined {
  return video.videoWidth > 0 && video.videoHeight > 0
    ? video.videoWidth / video.videoHeight
    : undefined;
}

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError')
    return 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.';
  if (name === 'NotFoundError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  return `Could not start the drive: ${e instanceof Error ? e.message : String(e)}`;
}
