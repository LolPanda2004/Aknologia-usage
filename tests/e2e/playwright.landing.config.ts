// Landing page config (QA agent 6).  cd tests/e2e && npx playwright test -c playwright.landing.config.ts
import { defineConfig } from '@playwright/test';

const combos = [
  { theme: 'light', w: 1440, h: 900 },
  { theme: 'dark', w: 1440, h: 900 },
  { theme: 'light', w: 390, h: 844 },
  { theme: 'dark', w: 390, h: 844 },
] as const;

export default defineConfig({
  testDir: '.',
  testMatch: /landing\.spec\.ts$/,
  timeout: 120_000,
  workers: 1,
  retries: 0,
  outputDir: 'test-results-landing',
  reporter: [['list']],
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:8080', locale: 'en-US' },
  projects: combos.map((c) => ({
    name: `landing-${c.theme}-${c.w}`,
    use: { browserName: 'chromium' as const, colorScheme: c.theme, viewport: { width: c.w, height: c.h } },
  })),
});
