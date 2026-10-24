// Loads the parsed drive fixtures that modules receive as ctx.fixtures. Never loads
// annotations.json: that file is for tests only (AGENTS.md rule 6).
import type { Fixtures } from '../../../shared/types.ts';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export async function loadFixtures(): Promise<Fixtures> {
  const [track, features, route] = await Promise.all([
    getJson<Fixtures['track']>('/demo-drive/track.json'),
    getJson<Fixtures['features']>('/demo-drive/features.json'),
    getJson<Fixtures['route']>('/demo-drive/route.json'),
  ]);
  return { track, features, route };
}
