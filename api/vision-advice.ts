import { createVisionAdviceHandler } from '../server/visionAdvice.ts';
const handle = createVisionAdviceHandler({
  getKey: () => process.env.ANTHROPIC_API_KEY,
  getModel: () => process.env.ANTHROPIC_MODEL,
});
export function POST(request: Request): Promise<Response> {
  return handle(request);
}
