// Mock registry for the `?mock=map,vision,voice,arbiter,assistant` URL switch (see main.tsx).
import type { AppModule } from '../types.ts';
import { createMockArbiter } from './arbiter.ts';
import { createMockAssistant } from './assistant.ts';
import { createMockMap } from './map.ts';
import { createMockVision } from './vision.ts';
import { createMockVoice } from './voice.ts';

export const mockFactories: Record<AppModule['name'], () => AppModule> = {
  map: createMockMap,
  vision: createMockVision,
  voice: createMockVoice,
  arbiter: createMockArbiter,
  assistant: createMockAssistant,
};
