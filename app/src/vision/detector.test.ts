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
  for (let i = 2; i <= 8; i++) detector.detect(video, 125 * i);
  const timestamps = detect.mock.calls.map((call) => (call as unknown as [unknown, number])[1]);
  expect(timestamps.every((time, index) => index === 0 || time > timestamps[index - 1]!)).toBe(
    true,
  );
  expect(detect).toHaveBeenCalledTimes(11); // Warmup, eight full frames, two crops.
  expect(draw).toHaveBeenCalledWith(video, 960, 0, 960, 810, 0, 0, 640, 540);
  detector.close();
});

it('remaps crop coordinates and suppresses duplicate signs without removing nearby objects', async () => {
  const { mergeCropDetections } = await import('./detector.ts');
  const sign = { cls: 'stop sign' as const, score: 0.8, box: { x: 0.6, y: 0.15, w: 0.1, h: 0.15 } };
  const cropped = { ...sign, score: 0.9, box: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 } };
  const merged = mergeCropDetections([sign, { ...sign, cls: 'car' }], [cropped], {
    x: 0.5,
    y: 0,
    w: 0.5,
    h: 0.75,
  });
  expect(merged).toHaveLength(2);
  expect(merged[0]?.score).toBe(0.9);
  expect(merged[0]?.box.x).toBeCloseTo(0.6);
  expect(merged[0]?.box.h).toBeCloseTo(0.15);
});
