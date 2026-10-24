import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Local generation must not silently use an old exported key instead of the edited .env.
export async function loadLocalKey(
  path = '.env',
  environment: Record<string, string | undefined> = process.env,
): Promise<string> {
  let local: Record<string, string | undefined> = {};
  try {
    local = parseEnv(await readFile(path, 'utf8'));
  } catch (error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
      throw error;
  }
  const key = local.CARTESIA_API_KEY ?? environment.CARTESIA_API_KEY;
  if (!key?.trim()) throw new Error('Set CARTESIA_API_KEY in the git-ignored .env file.');
  return key;
}
