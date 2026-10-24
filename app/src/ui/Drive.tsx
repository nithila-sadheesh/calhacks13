// The drive screen layout and module startup. Owns the one <video> element: once it exists it
// loads fixtures, builds the replay clock and starts every module with the shared context.
// Slots: VisionOverlay over the video; UpcomingPanel and VoicePanel in the side panel.
import { useEffect, useRef, useState } from 'react';
import type { AppModule, Bus, ModuleContext } from '../../../shared/types.ts';
import { UpcomingPanel } from '../map/UpcomingPanel.tsx';
import { createReplay } from '../replay/replay.ts';
import { loadFixtures } from '../replay/fixtures.ts';
import { VisionOverlay } from '../vision/VisionOverlay.tsx';
import { VoicePanel } from '../voice/VoicePanel.tsx';
import { Captions } from './Captions.tsx';
import { DataUsePanel } from './DataUsePanel.tsx';
import { Timeline } from './Timeline.tsx';

type DriveProps = { bus: Bus; modules: AppModule[] };

export function Drive({ bus, modules }: DriveProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ctx, setCtx] = useState<ModuleContext>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;

    loadFixtures()
      .then(async (fixtures) => {
        if (cancelled) return;
        const replay = createReplay(video, bus);
        dispose = replay.dispose;
        const next = { bus, clock: replay.clock, video, fixtures };
        await Promise.all(modules.map((m) => m.start(next)));
        // Unmounted while starting: the cleanup's stop() ran too early, so stop again.
        if (cancelled) modules.forEach((m) => m.stop());
        else setCtx(next);
      })
      .catch((e: unknown) => setError(String(e)));

    return () => {
      cancelled = true;
      dispose?.();
      modules.forEach((m) => m.stop());
    };
  }, [bus, modules]);

  return (
    <main className="drive">
      <section className="stage">
        <div className="video-wrap">
          <video ref={videoRef} src="/demo-drive/video.mp4" controls muted playsInline />
          {ctx && <VisionOverlay ctx={ctx} />}
        </div>
        <Captions bus={bus} />
      </section>
      <aside className="side">
        {error && <p role="alert">{error}</p>}
        {ctx && <UpcomingPanel ctx={ctx} />}
        {ctx && <VoicePanel ctx={ctx} />}
        <DataUsePanel bus={bus} />
      </aside>
      <Timeline bus={bus} />
    </main>
  );
}
