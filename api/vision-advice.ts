import { createVisionAdviceHandler } from '../server/visionAdvice.js';
const handle = createVisionAdviceHandler({
  getKey: () => process.env.ANTHROPIC_API_KEY,
  getModel: () => process.env.ANTHROPIC_MODEL,
  getRegion: () => process.env.COACHING_JURISDICTION,
});
export function POST(request: Request): Promise<Response> {
  return handle(request);
}
