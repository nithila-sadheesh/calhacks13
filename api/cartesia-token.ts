// `.js`, not `.ts`: Vercel compiles this function to JavaScript and keeps the import path as
// written, so a `.ts` path fails at runtime. TypeScript and Vite map `.js` back to the source.
import { createTokenHandler } from '../scripts/voice/tokenEndpoint.js';

// In-memory limiter is shared by requests in this warm function instance.
const handle = createTokenHandler({ getKey: () => process.env.CARTESIA_API_KEY });

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
