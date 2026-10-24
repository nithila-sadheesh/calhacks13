// Tejas's vision module (STUB). Will run the MediaPipe detector on frames of ctx.video, track
// boxes, and emit `webcamAlert` / `cameraHealth` from real detections only.
// Publishes: webcamAlert, cameraHealth. See docs/DESIGN.md, "Tejas: vision and overlay".
import { log } from '../../../shared/log.ts';
import type { AppModule } from '../../../shared/types.ts';

export const visionModule: AppModule = {
  name: 'vision',
  async start() {
    log('vision', 'started');
  },
  stop() {},
};
