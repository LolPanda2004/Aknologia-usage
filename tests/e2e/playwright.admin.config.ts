// Admin console end-to-end config (separate from the member/desktop config so both agents can run independently).
//   cd tests/e2e && npx playwright test -c playwright.admin.config.ts
// Env: BASE_URL (default http://localhost:8080). The server must run with DEV_MODE=true (codes are read from its log,
// tests/.server.log, falling back to `docker compose logs server`). FULL_ALL=1 runs the full functional flow in every
// project (default: light 1440 only; the other projects run the pages/theme/layout pass).
import { defineConfig } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:8080';
const combos = [
  { theme: 'light', w: 1440, h: 900 },
  { theme: 'dark', w: 1440, h: 900 },
  { theme: 'light', w: 390, h: 844 },
  { theme: 'dark', w: 390, h: 844 },
] as const;

export default defineConfig({
  testDir: '.',
  testMatch: /admin\.spec\.ts$/,
  timeout: 5 * 60_000,
  expect: { timeout: 10_000 },
  workers: Number(process.env.WORKERS ?? 3),
  fullyParallel: true,
  retries: 0,
  outputDir: 'test-results-admin',
  reporter: [['list'], ['json', { outputFile: 'test-results-admin/report.json' }]],
  use: {
    baseURL: base,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    acceptDownloads: true,
    actionTimeout: 15_000,
  },
  projects: combos.map((c) => ({
    name: `admin-${c.theme}-${c.w}`,
    use: { browserName: 'chromium' as const, colorScheme: c.theme, viewport: { width: c.w, height: c.h } },
    metadata: { theme: c.theme, width: c.w, height: c.h },
  })),
});
