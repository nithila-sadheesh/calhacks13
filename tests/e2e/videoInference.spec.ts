import { expect, test } from '@playwright/test';

test('recorded video frames run through the real detector and alert rules', async ({ page }) => {
  await page.goto('/?mock=map,vision,voice');
  const summary = await page.evaluate(async () => {
    const detectorPath = '/app/src/vision/detector.ts';
    const trackerPath = '/app/src/vision/tracker.ts';
    const alertsPath = '/app/src/vision/alerts.ts';
    const geometryPath = '/app/src/vision/geometry.ts';
    const { loadDetector }: typeof import('../../app/src/vision/detector.ts') = await import(
      detectorPath
    );
    const { createTracker }: typeof import('../../app/src/vision/tracker.ts') = await import(
      trackerPath
    );
    const { createAlertEngine }: typeof import('../../app/src/vision/alerts.ts') = await import(
      alertsPath
    );
    const {
      pointInForwardRegion,
      bottomCenter,
    }: typeof import('../../app/src/vision/geometry.ts') = await import(geometryPath);
    const detector = await loadDetector();
    const tracker = createTracker();
    const alerts = createAlertEngine();
    const video = document.createElement('video');
    video.muted = true;
    video.src = '/demo-drive/video.mp4';
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Recorded video could not load'));
    });
    const result = {
      frames: 0,
      detections: 0,
      personDetections: 0,
      qualifyingPedestrianFrames: 0,
      maxPersonConfidence: 0,
      alerts: [] as string[],
    };
    try {
      for (let seconds = 0.125; seconds < video.duration; seconds += 0.125) {
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          video.currentTime = seconds;
        });
        const detections = detector.detect(video, seconds * 1000);
        result.frames++;
        result.detections += detections.length;
        const people = detections.filter((detection) => detection.cls === 'person');
        result.personDetections += people.length;
        result.maxPersonConfidence = Math.max(
          result.maxPersonConfidence,
          ...people.map((person) => person.score),
        );
        const tracks = tracker.update(detections);
        if (
          tracks.some(
            (track) =>
              track.cls === 'person' &&
              track.score >= 0.6 &&
              pointInForwardRegion(bottomCenter(track.box)),
          )
        )
          result.qualifyingPedestrianFrames++;
        const alert = alerts.update({ tracks, tripMs: seconds * 1000, speedMps: 0 });
        if (alert) result.alerts.push(alert.alert.reason);
      }
      return result;
    } finally {
      detector.close();
      video.removeAttribute('src');
      video.load();
    }
  });
  console.log('Recorded video inference:', JSON.stringify(summary));
  expect(summary.frames).toBeGreaterThan(0);
  // No alert quota: footage must never be forced to produce a warning.
});
