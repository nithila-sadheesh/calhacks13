// Tejas's over-the-video slot (STUB). Will draw detection boxes, the forward region, and the
// detection behind the current alert. Fills its parent (the video wrapper).
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';

export function VisionOverlay({ ctx }: PanelProps) {
  const alerts = useEvents(ctx.bus, 'webcamAlert');
  const last = alerts.at(-1);
  return (
    <div className="overlay">{last && <span className="overlay-note">{last.reason}</span>}</div>
  );
}
