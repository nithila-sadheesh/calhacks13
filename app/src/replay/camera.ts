// Device access for live trips: the rear camera feeds the shared <video>, and a screen wake lock
// keeps the phone from sleeping mid-drive. Frames never leave the device.

// 720p is plenty: vision downscales every frame to 640 px wide before inference.
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  },
};

export async function openCamera(video: HTMLVideoElement): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access needs HTTPS and a browser that supports it.');
  }
  const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  video.srcObject = stream;
  await video.play();
  return () => {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

// Best effort: unsupported browsers just let the screen sleep. The lock is dropped whenever the
// page is hidden, so it is taken again when the page comes back.
export function holdWakeLock(): () => void {
  let sentinel: WakeLockSentinel | undefined;
  let released = false;
  const acquire = () => {
    if (released || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    navigator.wakeLock
      .request('screen')
      .then((s) => {
        if (released) void s.release();
        else sentinel = s;
      })
      .catch(() => {});
  };
  acquire();
  document.addEventListener('visibilitychange', acquire);
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', acquire);
    void sentinel?.release();
  };
}
