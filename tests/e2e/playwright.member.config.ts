// Member experience (desktop window in a browser) end-to-end config.
//   cd tests/e2e && npx playwright test -c playwright.member.config.ts
// Needs: server on :8080 with DEV_MODE=true (codes streamed to tests/.server.log), `npm run dev:desktop` on :5174,
// and tests/bin/aknologia-agent.exe built. The spec starts/stops its own sandboxed agent on 127.0.0.1:47811.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /member\.spec\.ts$/,
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: 'test-results-member',
  reporter: [['list'], ['json', { outputFile: 'test-results-member/report.json' }]],
  use: {
    baseURL: 'http://localhost:5174',
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    browserName: 'chromium',
  },
});
