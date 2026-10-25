import { afterEach, expect, it, vi } from 'vitest';
import { createFrameCapture } from './capture.ts';
afterEach(() => vi.unstubAllGlobals());
it('waits for decoded frames and captures resized JPEGs without uploading', () => {
  const draw = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: draw }),
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,/9j/AA=='),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  const capture = createFrameCapture();
  expect(capture({ readyState: 0 } as HTMLVideoElement, 0)).toBeUndefined();
  const video = { readyState: 4, videoWidth: 3840, videoHeight: 2160 } as HTMLVideoElement;
  expect(capture(video, 1234)).toEqual({ tripMs: 1234, jpeg: '/9j/AA==' });
  expect(draw).toHaveBeenCalledWith(video, 0, 0, 960, 540);
  expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.65);
});
it('does not submit frames exceeding the server image limit', () => {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toDataURL: () => `data:image/jpeg;base64,${'a'.repeat(240001)}`,
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  expect(
    createFrameCapture()(
      { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement,
      0,
    ),
  ).toBeUndefined();
});
