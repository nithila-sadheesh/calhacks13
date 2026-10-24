// End-to-end tests in tests/e2e. They run in installed Chrome (`channel: 'chrome'`) because
// Playwright's bundled Chromium cannot play the H.264 drive video.
import { defineConfig } from '@playwright/test';

const port = 5174;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
