// Jeev's track script. Converts a GPX file to fixtures/demo-drive/track.json, deriving speed and
// heading where missing and applying syncOffsetMs so tMs is milliseconds since the video's first
// frame. Sync with exactly one of:
//   npm run track -- drive.gpx --video-start 2026-10-24T18:03:12.400Z
//   npm run track -- drive.gpx --clap-video-s 2.4 --clap-utc 2026-10-24T18:03:14.800Z
//   npm run track -- drive.gpx --offset-ms -4200
// Then check the two landmarks in annotations.json (`npm test`) and adjust --offset-ms.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseGpx, resolveSyncOffsetMs, toTrack, type SyncOptions } from './gpx.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'fixtures/demo-drive/track.json' },
    'offset-ms': { type: 'string' },
    'video-start': { type: 'string' },
    'clap-video-s': { type: 'string' },
    'clap-utc': { type: 'string' },
  },
});

function parseTime(label: string, text: string): number {
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`${label}: not an ISO 8601 time: ${text}`);
  return ms;
}

function parseNumber(label: string, text: string): number {
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error(`${label}: not a number: ${text}`);
  return n;
}

function main() {
  const input = positionals[0];
  if (!input) throw new Error('Usage: npm run track -- <drive.gpx> [--video-start ISO | ...]');

  const sync: SyncOptions = {};
  if (values['offset-ms'] !== undefined)
    sync.offsetMs = parseNumber('--offset-ms', values['offset-ms']);
  if (values['video-start'] !== undefined)
    sync.videoStartMs = parseTime('--video-start', values['video-start']);
  const clapS = values['clap-video-s'];
  const clapUtc = values['clap-utc'];
  if ((clapS === undefined) !== (clapUtc === undefined))
    throw new Error('--clap-video-s and --clap-utc go together');
  if (clapS !== undefined && clapUtc !== undefined)
    sync.clap = {
      videoMs: parseNumber('--clap-video-s', clapS) * 1000,
      utcMs: parseTime('--clap-utc', clapUtc),
    };

  const points = parseGpx(readFileSync(resolve(input), 'utf8'));
  if (points.length === 0) throw new Error(`${input}: no <trkpt> elements found`);
  const firstFixMs = Math.min(...points.map((p) => p.timeMs));
  const syncOffsetMs = resolveSyncOffsetMs(firstFixMs, sync);
  if (Object.keys(sync).length === 0)
    console.warn('No sync option given: assuming GPS and video started together (offset 0).');

  const track = toTrack(points, syncOffsetMs);
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(track, null, 2)}\n`);

  const last = track.points.at(-1);
  const withAccuracy = track.points.filter((p) => p.accuracyM !== undefined).length;
  console.log(`Wrote ${out}`);
  console.log(`  ${track.points.length} points, syncOffsetMs ${track.syncOffsetMs}`);
  console.log(`  covers ${((last?.tMs ?? 0) / 1000).toFixed(1)} s of video`);
  console.log(`  ${withAccuracy} points carry accuracy`);
  if (withAccuracy === 0)
    console.warn('  No accuracy in this GPX: the 25 m GPS-quality gate cannot apply.');
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
