// Pure box geometry, unit-testable without a browser (AGENTS.md section 6). All boxes are in
// normalized [0,1] frame coordinates so the overlay and the alert rules never depend on the
// inference resolution.
import { FORWARD_REGION, type ForwardRegion } from './config.ts';

export type Box = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

// Intersection-over-union of two boxes. 0 when they do not overlap.
export function iou(a: Box, b: Box): number {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

// The ground-contact point of a box: bottom-center. Used to decide region membership, so a tall
// pedestrian is placed by their feet, not their head.
export function bottomCenter(b: Box): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h };
}

// EMA blend of two boxes. weight is the pull toward the newer box.
export function smoothBox(prev: Box, next: Box, weight: number): Box {
  const blend = (p: number, n: number) => p + (n - p) * weight;
  return {
    x: blend(prev.x, next.x),
    y: blend(prev.y, next.y),
    w: blend(prev.w, next.w),
    h: blend(prev.h, next.h),
  };
}

// Whether a point falls inside the forward-region trapezoid. The left and right edges are
// linearly interpolated between the top and bottom of the region.
export function pointInForwardRegion(p: Point, region: ForwardRegion = FORWARD_REGION): boolean {
  if (p.y < region.topY || p.y > region.bottomY) return false;
  const t = (p.y - region.topY) / (region.bottomY - region.topY);
  const left = region.topLeftX + t * (region.bottomLeftX - region.topLeftX);
  const right = region.topRightX + t * (region.bottomRightX - region.topRightX);
  return p.x >= left && p.x <= right;
}

// The four corners of the forward region in normalized coordinates, for drawing the overlay.
export function regionPolygon(region: ForwardRegion = FORWARD_REGION): Point[] {
  return [
    { x: region.topLeftX, y: region.topY },
    { x: region.topRightX, y: region.topY },
    { x: region.bottomRightX, y: region.bottomY },
    { x: region.bottomLeftX, y: region.bottomY },
  ];
}
