// Thin wrapper around the MediaPipe Tasks Vision object detector (EfficientDet-Lite0) in video
// mode. The wasm runtime and the model are vendored locally and served by Vite via `?url`, so the
// detector loads with no network call: video frames are processed entirely in the browser and
// never leave the device (AGENTS.md rule 9). See NOTES.md.
import { ObjectDetector, type ObjectDetectorResult } from '@mediapipe/tasks-vision';
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import modelUrl from './assets/efficientdet_lite0.tflite?url';
import {
  DETECTOR_CLASSES,
  INFERENCE_WIDTH,
  MAX_RESULTS,
  SCORE_THRESHOLD,
  type DetectorClass,
} from './config.ts';
import { iou } from './geometry.ts';
import type { Detection } from './tracker.ts';

const CLASS_SET: ReadonlySet<string> = new Set(DETECTOR_CLASSES);

export type VisionDetector = {
  // Run detection on one video frame. timestampMs must increase monotonically for the life of the
  // detector (a MediaPipe requirement); it is not trip time.
  detect(video: HTMLVideoElement, timestampMs: number): Detection[];
  close(): void;
};

export async function loadDetector(): Promise<VisionDetector> {
  // WasmFileset is a plain { wasmLoaderPath, wasmBinaryPath }; we build it from the vendored URLs
  // instead of FilesetResolver.forVisionTasks(basePath), which would need a served directory.
  const fileset = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl };

  const detector = await createWithFallback(fileset);

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    detector.close();
    throw new Error('Frame downscaling unavailable');
  }
  // Compile/warm the local inference path before replay starts. This blank canvas is
  // never treated as a road observation; real detector timestamps start above zero.
  canvas.width = INFERENCE_WIDTH;
  canvas.height = Math.round((INFERENCE_WIDTH * 9) / 16);
  try {
    detector.detectForVideo(canvas, 0);
  } catch (error: unknown) {
    detector.close();
    throw error;
  }
  let frame = 0;
  let inferenceTimestamp = 0;
  return {
    detect(video, timestampMs) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return [];
      const width = Math.min(vw, INFERENCE_WIDTH);
      const height = Math.max(1, Math.round((vh * width) / vw));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      inferenceTimestamp = Math.max(timestampMs, inferenceTimestamp + 1);
      const full = toDetections(detector.detectForVideo(canvas, inferenceTimestamp), width, height);
      // Every fourth frame magnifies a different roadside region. Keep only sign/signal
      // detections from this extra pass; full-frame inference still supplies road users.
      if (++frame % 4 !== 0) return full;
      const crop = { x: frame % 8 === 0 ? 0.5 : 0, y: 0, w: 0.5, h: 0.75 };
      const cropHeight = Math.max(1, Math.round((crop.h * vh * width) / (crop.w * vw)));
      canvas.height = cropHeight;
      context.drawImage(video, crop.x * vw, 0, crop.w * vw, crop.h * vh, 0, 0, width, cropHeight);
      const signs = toDetections(
        detector.detectForVideo(canvas, ++inferenceTimestamp),
        width,
        cropHeight,
      ).filter((item) => item.cls === 'stop sign' || item.cls === 'traffic light');
      return mergeCropDetections(full, signs, crop);
    },
    close() {
      detector.close();
    },
  };
}

// Prefer the GPU delegate; fall back to CPU if the WebGL context cannot be created.
async function createWithFallback(fileset: {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}): Promise<ObjectDetector> {
  const base = {
    runningMode: 'VIDEO' as const,
    scoreThreshold: SCORE_THRESHOLD,
    maxResults: MAX_RESULTS,
    categoryAllowlist: [...DETECTOR_CLASSES],
  };
  try {
    return await ObjectDetector.createFromOptions(fileset, {
      ...base,
      baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
    });
  } catch {
    return ObjectDetector.createFromOptions(fileset, {
      ...base,
      baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
    });
  }
}

function toDetections(result: ObjectDetectorResult, vw: number, vh: number): Detection[] {
  const out: Detection[] = [];
  for (const det of result.detections) {
    const bb = det.boundingBox;
    const top = det.categories[0];
    if (!bb || !top || !CLASS_SET.has(top.categoryName)) continue;
    out.push({
      cls: top.categoryName as DetectorClass,
      score: top.score,
      box: { x: bb.originX / vw, y: bb.originY / vh, w: bb.width / vw, h: bb.height / vh },
    });
  }
  return out;
}

export function mergeCropDetections(
  full: Detection[],
  cropped: Detection[],
  crop: { x: number; y: number; w: number; h: number },
): Detection[] {
  const remapped = cropped.map((item) => ({
    ...item,
    box: {
      x: crop.x + item.box.x * crop.w,
      y: crop.y + item.box.y * crop.h,
      w: item.box.w * crop.w,
      h: item.box.h * crop.h,
    },
  }));
  const kept: Detection[] = [];
  for (const item of [...full, ...remapped].sort((a, b) => b.score - a.score)) {
    if (!kept.some((other) => other.cls === item.cls && iou(other.box, item.box) > 0.4))
      kept.push(item);
  }
  return kept.slice(0, MAX_RESULTS);
}
