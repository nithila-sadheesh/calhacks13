// Vite config. `fixtures/` is the public dir, so the app fetches
// /demo-drive/*.json, /demo-drive/video.mp4 and /audio/* at runtime.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  publicDir: 'fixtures',
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**'] },
});
