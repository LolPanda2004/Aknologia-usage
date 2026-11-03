// Behaviour checks (check.spec.ts): drawer keyboard, modals fit, reduced motion, no replay. Same env as the audit.
//   cd tests/responsive && npx playwright test -c playwright.responsive.config.ts
// Env:
//   PHASE=before|after          output folder name (screenshots/<PHASE>, results/<PHASE>)   default: before
//   GROUPS=web,desktop          web = landing, /download/, admin console (server :8080); desktop = window (Vite :5174 + sandboxed agent)
//   WIDTHS=360,390,...          default 360,390,768,1024,1280,1440,1920 (desktop also gets 960x640)
//   THEMES=light,dark           AXE_WIDTHS=390,1440       REDUCED_MOTION=1 (emulate prefers-reduced-motion)
// Needs: server on :8080 with DEV_MODE=true (docker compose); for the desktop group `cd ui && npm run dev:desktop`
// and tests/bin/aknologia-agent.exe (the spec starts/stops its own agent on 127.0.0.1:47811 and restores HKCU Run).
// After a run: node summarize.mjs [PHASE]  -> prints the issue tables and writes axe-<PHASE>.json (axe-baseline.json for before).
// (node_modules here is a junction to tests/e2e/node_modules.)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /check\.spec\.ts$/,
  timeout: 30 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: 'test-results',
  reporter: [['list']],
  use: { locale: 'en-US', browserName: 'chromium', actionTimeout: 15_000, timezoneId: 'Asia/Kolkata' },
});
