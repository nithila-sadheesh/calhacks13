import { describe, expect, it } from 'vitest';
import { FORWARD_REGION } from './config.ts';
import { bottomCenter, iou, pointInForwardRegion, regionPolygon, smoothBox } from './geometry.ts';

describe('iou', () => {
  it('is 1 for identical boxes', () => {
    expect(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBeCloseTo(1);
  });

  it('is 0 for disjoint boxes', () => {
    expect(iou({ x: 0, y: 0, w: 0.2, h: 0.2 }, { x: 0.8, y: 0.8, w: 0.2, h: 0.2 })).toBe(0);
  });

  it('is a quarter for half-overlap in one axis', () => {
    // Two unit-area boxes sharing exactly half their width: inter 0.5, union 1.5.
    expect(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.5, y: 0, w: 1, h: 1 })).toBeCloseTo(0.5 / 1.5);
  });

  it('is 0 for a zero-area box', () => {
    expect(iou({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(0);
  });
});

describe('bottomCenter', () => {
  it('returns the mid-bottom point', () => {
    expect(bottomCenter({ x: 0.2, y: 0.1, w: 0.4, h: 0.6 })).toEqual({ x: 0.4, y: 0.7 });
  });
});

describe('smoothBox', () => {
  it('returns prev when weight is 0 and next when weight is 1', () => {
    const prev = { x: 0, y: 0, w: 0.2, h: 0.2 };
    const next = { x: 1, y: 1, w: 0.4, h: 0.4 };
    expect(smoothBox(prev, next, 0)).toEqual(prev);
    expect(smoothBox(prev, next, 1)).toEqual(next);
  });

  it('blends halfway at weight 0.5', () => {
    const out = smoothBox({ x: 0, y: 0, w: 0.2, h: 0.2 }, { x: 0.4, y: 0.4, w: 0.6, h: 0.6 }, 0.5);
    expect(out).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 });
  });
});

describe('pointInForwardRegion', () => {
  it('accepts a point at the center-bottom', () => {
    expect(pointInForwardRegion({ x: 0.5, y: 0.95 })).toBe(true);
  });

  it('rejects a point above the region', () => {
    expect(pointInForwardRegion({ x: 0.5, y: 0.2 })).toBe(false);
  });

  it('rejects a point to the far left at the bottom', () => {
    expect(pointInForwardRegion({ x: 0.02, y: 0.99 })).toBe(false);
  });

  it('rejects a wide point near the narrow top of the trapezoid', () => {
    // At the top the region spans only ~0.34..0.66, so x=0.2 is outside there even though it
    // would be inside lower down.
    expect(pointInForwardRegion({ x: 0.2, y: FORWARD_REGION.topY + 0.01 })).toBe(false);
    expect(pointInForwardRegion({ x: 0.2, y: 0.99 })).toBe(true);
  });
});

describe('regionPolygon', () => {
  it('returns the four trapezoid corners clockwise from top-left', () => {
    expect(regionPolygon()).toEqual([
      { x: FORWARD_REGION.topLeftX, y: FORWARD_REGION.topY },
      { x: FORWARD_REGION.topRightX, y: FORWARD_REGION.topY },
      { x: FORWARD_REGION.bottomRightX, y: FORWARD_REGION.bottomY },
      { x: FORWARD_REGION.bottomLeftX, y: FORWARD_REGION.bottomY },
    ]);
  });
});
