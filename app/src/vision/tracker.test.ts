import { describe, expect, it } from 'vitest';
import { TRACK_MAX_MISSES } from './config.ts';
import { createTracker } from './tracker.ts';

const box = (x: number, y: number, w = 0.2, h = 0.2) => ({ x, y, w, h });

describe('createTracker', () => {
  it('keeps one id for a box that moves a little each frame', () => {
    const t = createTracker();
    const a = t.update([{ cls: 'person', score: 0.9, box: box(0.4, 0.4) }]);
    const b = t.update([{ cls: 'person', score: 0.9, box: box(0.42, 0.4) }]);
    expect(a[0]?.id).toBe(1);
    expect(b[0]?.id).toBe(1);
  });

  it('assigns a new id to a non-overlapping box', () => {
    const t = createTracker();
    t.update([{ cls: 'person', score: 0.9, box: box(0.1, 0.1) }]);
    const b = t.update([{ cls: 'person', score: 0.9, box: box(0.8, 0.8) }]);
    expect(b[0]?.id).toBe(2);
  });

  it('does not match boxes of different classes even when they overlap', () => {
    const t = createTracker();
    const a = t.update([{ cls: 'person', score: 0.9, box: box(0.4, 0.4) }]);
    const b = t.update([{ cls: 'car', score: 0.9, box: box(0.4, 0.4) }]);
    expect(a[0]?.id).toBe(1);
    expect(b[0]?.id).toBe(2);
  });

  it('smooths the box toward the new position rather than snapping', () => {
    const t = createTracker(0.3, 0.5);
    t.update([{ cls: 'person', score: 0.9, box: box(0.4, 0.4) }]);
    // Move by half a box width so the boxes still overlap enough to associate.
    const b = t.update([{ cls: 'person', score: 0.9, box: box(0.5, 0.4) }]);
    expect(b[0]?.id).toBe(1); // same track, not a new one
    // Halfway between 0.4 and 0.5 at weight 0.5.
    expect(b[0]?.box.x).toBeCloseTo(0.45);
  });

  it('drops a track after it is missing for too many frames, then reuses nothing', () => {
    const t = createTracker();
    t.update([{ cls: 'person', score: 0.9, box: box(0.4, 0.4) }]);
    for (let i = 0; i < TRACK_MAX_MISSES; i += 1) t.update([]);
    // One more empty frame pushes misses past the limit and the track is gone.
    t.update([]);
    const back = t.update([{ cls: 'person', score: 0.9, box: box(0.4, 0.4) }]);
    expect(back[0]?.id).toBe(2);
  });

  it('reset clears tracks and restarts ids', () => {
    const t = createTracker();
    t.update([{ cls: 'person', score: 0.9, box: box(0.4, 0.4) }]);
    t.reset();
    const after = t.update([{ cls: 'person', score: 0.9, box: box(0.4, 0.4) }]);
    expect(after[0]?.id).toBe(1);
  });

  it('matches two people to their nearer tracks, not crossed', () => {
    const t = createTracker();
    t.update([
      { cls: 'person', score: 0.9, box: box(0.1, 0.5) },
      { cls: 'person', score: 0.9, box: box(0.7, 0.5) },
    ]);
    const next = t.update([
      { cls: 'person', score: 0.9, box: box(0.72, 0.5) },
      { cls: 'person', score: 0.9, box: box(0.12, 0.5) },
    ]);
    const byId = new Map(next.map((tr) => [tr.id, tr.box.x]));
    expect(byId.get(1)).toBeCloseTo(0.11, 1); // left track stayed left
    expect(byId.get(2)).toBeCloseTo(0.71, 1); // right track stayed right
  });
});
