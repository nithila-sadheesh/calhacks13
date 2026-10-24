import { createTokenHandler } from '../scripts/voice/tokenEndpoint.ts';

// In-memory limiter is shared by requests in this warm function instance.
const handle = createTokenHandler({ getKey: () => process.env.CARTESIA_API_KEY });

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
