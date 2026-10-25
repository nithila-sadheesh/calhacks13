// Tejas's over-the-video slot. Draws the detection boxes, the fixed forward region, and a
// highlight on the box behind the current alert, plus the alert's reason (docs/DESIGN.md task 8).
// It reads detections from the in-module store (filled by the frame loop) and falls back to the
// bus `webcamAlert` reason so it still shows something under `?mock=vision`.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useEvents } from '../../../shared/useEvents.ts';
import type { PanelProps } from '../../../shared/types.ts';
import { regionPolygon } from './geometry.ts';
import { visionStore, type VisionSnapshot } from './store.ts';

const COLORS = { box: '#38bdf8', region: '#facc15', alert: '#f43f5e' };

export function VisionOverlay({ ctx }: PanelProps) {
  const snapshot = useSyncExternalStore(visionStore.subscribe, visionStore.get);
  const busAlerts = useEvents(ctx.bus, 'webcamAlert');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) draw(canvas, snapshot);
  }, [snapshot]);

  const reason = snapshot.alertReason ?? busAlerts.at(-1)?.reason ?? null;

  return (
    <div className="overlay">
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {!snapshot.health.ok && (
        <span
          className="overlay-note"
          style={{ top: '0.5rem', bottom: 'auto', background: '#7f1d1d' }}
        >
          Camera paused. Route reminders only.
          {snapshot.health.reason ? ` (${snapshot.health.reason})` : ''}
        </span>
      )}
      {reason && <span className="overlay-note">{reason}</span>}
    </div>
  );
}

function draw(canvas: HTMLCanvasElement, snapshot: VisionSnapshot): void {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);

  drawRegion(g, cssW, cssH);

  for (const det of snapshot.detections) {
    const isAlert = det.id === snapshot.alertTrackId;
    const color = isAlert ? COLORS.alert : det.inRegion ? COLORS.region : COLORS.box;
    const x = det.box.x * cssW;
    const y = det.box.y * cssH;
    const w = det.box.w * cssW;
    const h = det.box.h * cssH;

    g.lineWidth = isAlert ? 4 : 2;
    g.strokeStyle = color;
    g.strokeRect(x, y, w, h);

    const label = `${det.cls} ${Math.round(det.score * 100)}%`;
    g.font = '14px system-ui, sans-serif';
    const textW = g.measureText(label).width + 8;
    g.fillStyle = color;
    g.fillRect(x, Math.max(0, y - 18), textW, 18);
    g.fillStyle = '#0b0b0f';
    g.fillText(label, x + 4, Math.max(12, y - 4));
  }
}

function drawRegion(g: CanvasRenderingContext2D, cssW: number, cssH: number): void {
  const pts = regionPolygon();
  g.beginPath();
  pts.forEach((p, i) => {
    const x = p.x * cssW;
    const y = p.y * cssH;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.setLineDash([6, 6]);
  g.lineWidth = 2;
  g.strokeStyle = COLORS.region;
  g.stroke();
  g.setLineDash([]);
}
