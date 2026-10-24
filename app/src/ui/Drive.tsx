// The drive screen layout and module startup. Owns the one <video> element.
// Phase 1 (once the <video> exists): load fixtures and build the replay clock and context.
// Phase 2 (once the context is rendered): start every module. Child effects run before parent
// effects, so every panel has subscribed to the bus before any module's start() can emit.
// Slots: VisionOverlay over the video; UpcomingPanel and VoicePanel in the side panel.
import { useEffect, useRef, useState } from 'react';
import type { AppModule, Bus, ModuleContext } from '../../../shared/types.ts';
import { UpcomingPanel } from '../map/UpcomingPanel.tsx';
import { createReplay } from '../replay/replay.ts';
import { loadFixtures } from '../replay/fixtures.ts';
import { VisionOverlay } from '../vision/VisionOverlay.tsx';
import { voiceModule } from '../voice/index.ts';
import { VoicePanel } from '../voice/VoicePanel.tsx';
import { Captions } from './Captions.tsx';
import { DataUsePanel } from './DataUsePanel.tsx';
import { Timeline } from './Timeline.tsx';

type DriveProps = { bus: Bus; modules: AppModule[] };
type Session = { ctx: ModuleContext; announce: () => void };

export function Drive({ bus, modules }: DriveProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const realVoice = modules.includes(voiceModule);
  const canPlay = ready && (!realVoice || soundEnabled);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;

    loadFixtures()
      .then((fixtures) => {
        if (cancelled) return;
        const replay = createReplay(video, bus);
        dispose = replay.dispose;
        setSession({
          ctx: { bus, clock: replay.clock, video, fixtures },
          announce: replay.announce,
        });
      })
      .catch((e: unknown) => setError(String(e)));

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [bus]);

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

  const ctx = session?.ctx;
  return (
    <main className="drive">
      <section className="stage">
        <div className="video-wrap">
          <video
            ref={videoRef}
            src="/demo-drive/video.mp4"
            controls={canPlay}
            onPlay={() => {
              if (!canPlay) videoRef.current?.pause();
            }}
            controlsList="noplaybackrate nodownload"
            disablePictureInPicture
            muted
            playsInline
            onError={() => setError('Could not load the drive video (/demo-drive/video.mp4).')}
          />
          {ctx && <VisionOverlay ctx={ctx} />}
        </div>
        {!ready && !error && <p role="status">Loading drive modules…</p>}
        {ready && realVoice && !soundEnabled && (
          <button
            type="button"
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
        <Captions bus={bus} />
      </section>
      <aside className="side">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {ctx && <UpcomingPanel ctx={ctx} />}
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
        <DataUsePanel bus={bus} />
      </aside>
      <Timeline bus={bus} />
    </main>
  );
}
