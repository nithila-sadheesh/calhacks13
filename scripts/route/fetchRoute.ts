// Jeev's route script. Run once per route, never at app runtime:
//   npm run route -- --from-track 12        waypoints sampled from fixtures/demo-drive/track.json
//   npm run route -- --waypoints "37.8716,-122.2727;37.8740,-122.2690;37.8716,-122.2727"
// Fetches an OSRM driving route with steps, then Overpass stop signs, crosswalks and signals on
// that route (with their ways, to tell our road from cross streets), applies scripts/route/curated.json, and writes route.json and
// features.json. Read the printed warnings and check flagged nodes on openstreetmap.org.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildRouteLine, type LonLat } from '../../app/src/map/geo.ts';
import type { Track } from '../../shared/types.ts';
import {
  buildFixtures,
  nearRouteNodeIds,
  parseCurated,
  parseOsrm,
  sampleWaypoints,
  trackDeviation,
  type OsmNode,
  type OsmWay,
  type OsrmResponse,
} from './routeFeatures.ts';

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'learner-copilot-fixture-script/1.0 (hackathon project; one-off fetch)';
const MAX_WAYPOINTS = 25;

const { values } = parseArgs({
  options: {
    waypoints: { type: 'string' },
    'from-track': { type: 'string' },
    track: { type: 'string', default: 'fixtures/demo-drive/track.json' },
    curated: { type: 'string', default: 'scripts/route/curated.json' },
    out: { type: 'string', default: 'fixtures/demo-drive' },
  },
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function parseWaypoints(text: string): LonLat[] {
  return text.split(';').map((pair) => {
    const [lat, lon] = pair.split(',').map(Number);
    if (lat === undefined || lon === undefined || !Number.isFinite(lat + lon))
      throw new Error(`--waypoints: expected "lat,lon;lat,lon", got "${pair}"`);
    return [lon, lat];
  });
}

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, ...init.headers },
  });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function overpass<T>(query: string): Promise<T[]> {
  const json = (await getJson(OVERPASS_URL, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
  })) as { elements?: T[] };
  return json.elements ?? [];
}

async function main() {
  let waypoints: LonLat[];
  if (values.waypoints) waypoints = parseWaypoints(values.waypoints);
  else if (values['from-track']) {
    const count = Number(values['from-track']);
    if (!Number.isInteger(count) || count < 2 || count > MAX_WAYPOINTS)
      throw new Error(`--from-track: a whole number from 2 to ${MAX_WAYPOINTS}`);
    waypoints = sampleWaypoints((readJson(values.track) as Track).points, count);
  } else throw new Error('Give --waypoints "lat,lon;..." or --from-track <count>');
  if (waypoints.length < 2) throw new Error('Need at least two waypoints');

  const coords = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const osrmUrl =
    `${OSRM_URL}/${coords}?overview=full&geometries=geojson&steps=true` + `&continue_straight=true`;
  console.log(`OSRM: routing through ${waypoints.length} waypoints`);
  const osrm = (await getJson(osrmUrl)) as OsrmResponse;
  const parsed = parseOsrm(osrm);

  const lons = parsed.coordinates.map((c) => c[0]);
  const lats = parsed.coordinates.map((c) => c[1]);
  const pad = 0.0005;
  const bbox = [
    Math.min(...lats) - pad,
    Math.min(...lons) - pad,
    Math.max(...lats) + pad,
    Math.max(...lons) + pad,
  ].join(',');
  console.log('Overpass: fetching stop signs, crossings and signals');
  const osmNodes = await overpass<OsmNode>(
    `[out:json][timeout:60];(` +
      `node["highway"="stop"](${bbox});` +
      `node["highway"="traffic_signals"](${bbox});` +
      `node["highway"="crossing"](${bbox});` +
      `);out body;`,
  );
  const nearIds = nearRouteNodeIds(buildRouteLine(parsed.coordinates), osmNodes);
  const ways = nearIds.length
    ? await overpass<OsmWay>(
        `[out:json][timeout:60];node(id:${nearIds.join(',')});way(bn)["highway"];out geom;`,
      )
    : [];

  const curated = parseCurated(readJson(values.curated));
  const { route, features, warnings } = buildFixtures({ osrm, osmNodes, ways, curated });

  const outDir = resolve(values.out);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'route.json'), `${JSON.stringify(route)}\n`);
  writeFileSync(resolve(outDir, 'features.json'), `${JSON.stringify(features, null, 2)}\n`);

  const lengthM = osrm.routes?.[0]?.distance ?? 0;
  console.log(`\nWrote route.json (${route.coordinates.length} points, ${Math.round(lengthM)} m)`);
  console.log(`Wrote features.json (${features.length} features):`);
  for (const f of features) {
    const street = f.street ? ` onto ${f.street}` : '';
    console.log(
      `  ${String(Math.round(f.routeDistM)).padStart(5)} m  ${f.kind}${street}  [${f.source}] ${f.id}`,
    );
  }

  if (!values.waypoints) {
    const dev = trackDeviation(route, (readJson(values.track) as Track).points);
    console.log(
      `\nTrack vs route: max offset ${Math.round(dev.maxOffsetM)} m, ` +
        `${(dev.farShare * 100).toFixed(1)}% of fixes over 25 m away`,
    );
    if (dev.farShare > 0.05)
      warnings.push('The route strays from the recorded drive: add waypoints where it differs');
  }
  if (warnings.length) {
    console.warn(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.warn(`  - ${w}`));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
