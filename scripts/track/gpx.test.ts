import { describe, expect, it } from 'vitest';
import { parseGpx, resolveSyncOffsetMs, toTrack } from './gpx.ts';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="37.870000" lon="-122.270000"><ele>50</ele><time>2026-10-24T18:00:00Z</time><hdop>2</hdop></trkpt>
    <trkpt lat="37.870000" lon="-122.269886"><time>2026-10-24T18:00:01Z</time>
      <extensions><gpxtpx:speed>9.5</gpxtpx:speed><gpxtpx:course>-1</gpxtpx:course></extensions>
    </trkpt>
    <trkpt lon='-122.269772' lat='37.870000'><time>2026-10-24T18:00:02.000Z</time><horizontalAccuracy>4</horizontalAccuracy></trkpt>
  </trkseg></trk>
</gpx>`;

const T0 = Date.parse('2026-10-24T18:00:00Z');

describe('parseGpx', () => {
  it('reads positions, times and optional fields in any attribute order', () => {
    const points = parseGpx(GPX);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ timeMs: T0, lat: 37.87, lon: -122.27, accuracyM: 10 });
    expect(points[1]).toEqual({ timeMs: T0 + 1000, lat: 37.87, lon: -122.269886, speedMps: 9.5 });
    expect(points[2]?.accuracyM).toBe(4);
    expect(points[2]?.lon).toBe(-122.269772);
  });

  it('rejects a track point with no time', () => {
    expect(() => parseGpx('<trkpt lat="1" lon="2"></trkpt>')).toThrow(/no valid <time>/);
  });

  it('rejects self-closing points, which cannot carry a time', () => {
    expect(() => parseGpx('<trkpt lat="1" lon="2"/>')).toThrow();
  });
});

describe('resolveSyncOffsetMs', () => {
  it('supports offset, video start and clap', () => {
    expect(resolveSyncOffsetMs(T0, { offsetMs: -4200 })).toBe(-4200);
    // Video started 3 s after the first fix: first fix is at -3 s of video time.
    expect(resolveSyncOffsetMs(T0, { videoStartMs: T0 + 3000 })).toBe(-3000);
    // Clap 2.5 s into the video at T0 + 4 s UTC, so the video started at T0 + 1.5 s.
    expect(resolveSyncOffsetMs(T0, { clap: { videoMs: 2500, utcMs: T0 + 4000 } })).toBe(-1500);
    expect(resolveSyncOffsetMs(T0, {})).toBe(0);
  });

  it('refuses two sync methods at once', () => {
    expect(() => resolveSyncOffsetMs(T0, { offsetMs: 0, videoStartMs: T0 })).toThrow();
  });
});

describe('toTrack', () => {
  it('applies the offset, derives motion and keeps one fix before the video starts', () => {
    const track = toTrack(parseGpx(GPX), -1500);
    expect(track.syncOffsetMs).toBe(-1500);
    // Fixes at -1500, -500, 500: the first is dropped, -500 is kept for interpolation.
    expect(track.points.map((p) => p.tMs)).toEqual([-500, 500]);
    expect(track.points[0]?.speedMps).toBe(9.5);
    expect(track.points[1]?.speedMps).toBeCloseTo(10, 0);
    track.points.forEach((p) => expect(p.headingDeg).toBeCloseTo(90, 0));
    expect(track.points[1]?.accuracyM).toBe(4);
  });

  it('keeps every fix when the video starts first', () => {
    expect(toTrack(parseGpx(GPX), 2000).points.map((p) => p.tMs)).toEqual([2000, 3000, 4000]);
  });

  it('fails clearly on empty or fully pre-video tracks', () => {
    expect(() => toTrack([], 0)).toThrow(/no track points/);
    expect(() => toTrack(parseGpx(GPX), -10_000)).toThrow(/before the video/);
  });
});
