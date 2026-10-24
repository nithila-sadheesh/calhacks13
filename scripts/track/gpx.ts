// GPX to track.json, as pure functions (gpxToTrack.ts is the command-line wrapper).
// tMs = (fix time - first fix time) + syncOffsetMs, so syncOffsetMs = first fix time - video start.
import { withMotion } from '../../app/src/map/track.ts';
import type { Track, TrackPoint } from '../../shared/types.ts';

export type GpxPoint = {
  timeMs: number;
  lat: number;
  lon: number;
  speedMps?: number;
  headingDeg?: number;
  accuracyM?: number;
};

// Approximate horizontal error per unit of HDOP. Used only when the logger gives no accuracy.
const METRES_PER_HDOP = 5;

const TRKPT = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;

function attr(attrs: string, name: string): number | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(attrs);
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

// Text of the first child element with one of these local names, any namespace prefix.
function child(body: string, names: string[]): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?(?:${names.join('|')})\\b[^>]*>([^<]*)<\\/`, 'i').exec(body);
  return m?.[1]?.trim();
}

function num(text: string | undefined): number | undefined {
  if (text === undefined || text === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function parseGpx(xml: string): GpxPoint[] {
  const points: GpxPoint[] = [];
  for (const m of xml.matchAll(TRKPT)) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    const lat = attr(attrs, 'lat');
    const lon = attr(attrs, 'lon');
    const time = child(body, ['time']);
    if (lat === undefined || lon === undefined || !Number.isFinite(lat + lon)) continue;
    const timeMs = time === undefined ? NaN : Date.parse(time);
    if (!Number.isFinite(timeMs))
      throw new Error(`Track point at ${lat},${lon} has no valid <time>; cannot sync to video`);

    const p: GpxPoint = { timeMs, lat, lon };
    const speed = num(child(body, ['speed']));
    const course = num(child(body, ['course', 'heading']));
    const accuracy = num(child(body, ['horizontalAccuracy', 'horizontal_accuracy', 'hAcc']));
    const hdop = num(child(body, ['hdop']));
    if (speed !== undefined && speed >= 0) p.speedMps = speed;
    if (course !== undefined && course >= 0 && course <= 360) p.headingDeg = course;
    if (accuracy !== undefined && accuracy >= 0) p.accuracyM = accuracy;
    else if (hdop !== undefined && hdop >= 0) p.accuracyM = hdop * METRES_PER_HDOP;
    points.push(p);
  }
  return points;
}

export type SyncOptions = {
  offsetMs?: number; // syncOffsetMs as is
  videoStartMs?: number; // UTC time of the video's first frame
  clap?: { videoMs: number; utcMs: number }; // the clap: its time in the video and in UTC
};

export function resolveSyncOffsetMs(firstFixMs: number, options: SyncOptions): number {
  const given = [options.offsetMs, options.videoStartMs, options.clap].filter(
    (v) => v !== undefined,
  );
  if (given.length > 1) throw new Error('Give only one of --offset-ms, --video-start, --clap-*');
  if (options.offsetMs !== undefined) return options.offsetMs;
  if (options.videoStartMs !== undefined) return firstFixMs - options.videoStartMs;
  if (options.clap) return firstFixMs - (options.clap.utcMs - options.clap.videoMs);
  return 0;
}

const round = (v: number, digits: number) => Number(v.toFixed(digits));

// Speed and heading are derived over the whole recording first, then fixes from before the video
// starts are dropped, except the last one so the very first frame can still be interpolated.
export function toTrack(points: GpxPoint[], syncOffsetMs: number): Track {
  if (points.length === 0) throw new Error('GPX has no track points');
  const firstFixMs = Math.min(...points.map((p) => p.timeMs));
  const raw: TrackPoint[] = points.map(({ timeMs, ...rest }) => ({
    tMs: timeMs - firstFixMs + syncOffsetMs,
    ...rest,
  }));
  const motion = withMotion(raw);
  const firstInVideo = motion.findIndex((p) => p.tMs >= 0);
  if (firstInVideo === -1) throw new Error('Every track point is before the video starts');
  const kept = motion.slice(Math.max(0, firstInVideo - 1));

  return {
    syncOffsetMs: Math.round(syncOffsetMs),
    points: kept.map((p) => {
      const out: TrackPoint = {
        tMs: Math.round(p.tMs),
        lat: round(p.lat, 7),
        lon: round(p.lon, 7),
        speedMps: round(p.speedMps, 2),
        headingDeg: round(p.headingDeg, 1),
      };
      if (p.accuracyM !== undefined) out.accuracyM = round(p.accuracyM, 1);
      return out;
    }),
  };
}
