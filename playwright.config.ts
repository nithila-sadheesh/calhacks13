// End-to-end tests in tests/e2e. They run in installed Chrome (`channel: 'chrome'`) because
// Playwright's bundled Chromium cannot play the H.264 drive video. webkit.spec.ts runs in
// Playwright's WebKit (`npx playwright install webkit`), the engine of every iPhone browser.
import { defineConfig, devices } from '@playwright/test';

const port = 5174;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  // One at a time: the live tests depend on real-time audio and video timing.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' }, testIgnore: '**/webkit.spec.ts' },
    {
      name: 'webkit',
      use: { ...devices['iPhone 15'], browserName: 'webkit' },
      testMatch: '**/webkit.spec.ts',
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
