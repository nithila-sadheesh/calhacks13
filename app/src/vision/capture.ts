import type { VideoFrame } from '../../../shared/coaching.ts';
export function createFrameCapture() {
  let canvas: HTMLCanvasElement | undefined;
  return (video: HTMLVideoElement, tripMs: number): VideoFrame | undefined => {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    canvas ??= document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 960);
    canvas.height = Math.max(1, Math.round((video.videoHeight * canvas.width) / video.videoWidth));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    let jpeg = canvas.toDataURL('image/jpeg', 0.65).split(',')[1] ?? '';
    if (jpeg.length > 240_000) jpeg = canvas.toDataURL('image/jpeg', 0.4).split(',')[1] ?? '';
    if (!jpeg || jpeg.length > 240_000) return;
    return { tripMs, jpeg };
  };
}
