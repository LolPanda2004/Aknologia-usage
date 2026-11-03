// QA subagent 5: accessibility, contrast, keyboard and screenshot checks.
//   cd tests/a11y && npx playwright test -c playwright.a11y.config.ts
// (tests/a11y/node_modules is a junction to tests/e2e/node_modules.) Server must run on :8080 with DEV_MODE=true.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.a11y\.spec\.ts$/,
  timeout: 10 * 60_000,
  workers: 1,
  retries: 0,
  outputDir: 'test-results',
  reporter: [['list']],
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:8080', locale: 'en-US', browserName: 'chromium', viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 },
});
