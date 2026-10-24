import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({ ObjectDetector: { createFromOptions: mocks.create } }));
import { loadDetector } from './detector.ts';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('downscales frames locally and normalizes boxes against the resized dimensions', async () => {
  const draw = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }) };
  vi.stubGlobal('document', { createElement: () => canvas });
  const detect = vi.fn(() => ({
    detections: [
      {
        boundingBox: { originX: 64, originY: 36, width: 128, height: 72 },
        categories: [{ categoryName: 'person', score: 0.9 }],
      },
    ],
  }));
  mocks.create.mockResolvedValue({ detectForVideo: detect, close: vi.fn() });
  const detector = await loadDetector();
  const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
  expect(detector.detect(video, 125)[0]?.box).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  expect(draw).toHaveBeenCalledWith(video, 0, 0, 640, 360);
  expect(detect).toHaveBeenCalledWith(canvas, 125);
  detector.close();
});
