// Landing page + /download/ checks (QA agent 6).
//   cd tests/e2e && npx playwright test -c playwright.landing.config.ts
// Env: BASE_URL (default http://localhost:8080). Writes findings to ../dx/landing-results-<project>.json
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const out: Record<string, unknown> = {};
function save(project: string) {
  const dir = path.join(__dirname, '..', 'dx');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `landing-results-${project}.json`), JSON.stringify(out, null, 2));
}
test.afterAll(({}, info) => save(info.project.name));

async function prices(page: Page) {
  return page.locator('[data-annual]').allTextContents();
}

test.describe.configure({ mode: 'serial' });

test('anchors and nav links resolve', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => ({ href: a.getAttribute('href')!, text: (a.textContent || '').trim().slice(0, 40) })));
  const broken: { href: string; text: string }[] = [];
  for (const h of hrefs) {
    if (h.href.startsWith('#') && h.href.length > 1) {
      const n = await page.locator(`[id="${h.href.slice(1)}"]`).count();
      if (!n) broken.push(h);
    }
  }
  const internal = [...new Set(hrefs.map((h) => h.href).filter((h) => h.startsWith('/')))];
  const status: Record<string, number> = {};
  for (const u of internal) status[u] = (await page.request.get(u)).status();
  out.anchors = { total: hrefs.length, brokenAnchors: broken, internalStatus: status };
  expect(Object.values(status).every((s) => s === 200)).toBeTruthy();
  // Clicking a valid nav anchor scrolls to it
  // responsive upgrade: below 1024 the section links sit behind the header menu button
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  await page.locator('a[href="#pricing"]').first().click();
  await expect(page.locator('#pricing')).toBeInViewport();
});

test('theme toggle persists after reload', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator('.theme-toggle').first().click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  const bgAfter = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.reload();
  const reloaded = await page.evaluate(() => document.documentElement.dataset.theme);
  out.theme = { before, after, reloaded, bgAfter, toggles: await page.locator('.theme-toggle').count() };
  expect(reloaded).toBe(after);
  await page.evaluate(() => localStorage.removeItem('akn-theme'));
});

test('pricing monthly/annual switches all prices', async ({ page }) => {
  await page.goto('/');
  const initial = await prices(page);
  await page.locator('[data-bill="monthly"]').click();
  const monthly = await prices(page);
  const pressedM = await page.locator('[data-bill="monthly"]').getAttribute('aria-pressed');
  await page.locator('[data-bill="annual"]').click();
  const annual = await prices(page);
  const expectedM = await page.$$eval('[data-annual]', (els) => els.map((e) => (e as HTMLElement).dataset.monthly));
  const expectedA = await page.$$eval('[data-annual]', (els) => els.map((e) => (e as HTMLElement).dataset.annual));
  out.pricing = { initial, monthly, annual, pressedM, initialMatchesAnnual: JSON.stringify(initial) === JSON.stringify(expectedA) };
  expect(monthly).toEqual(expectedM);
  expect(annual).toEqual(expectedA);
});

test('demo form validation and submission', async ({ page }) => {
  await page.goto('/');
  const msg = page.locator('#demo-msg');
  // empty submit
  await page.locator('#demo-submit').click();
  await expect(msg).not.toBeEmpty();
  const emptyMsg = await msg.textContent();
  // bad email (type=email may block native submit; record what happens)
  await page.fill('#d-name', 'QA Six');
  await page.fill('#d-email', 'not-an-email');
  await msg.evaluate((e) => (e.textContent = ''));
  await page.locator('#demo-submit').click();
  await page.waitForTimeout(500);
  const badEmailMsg = await msg.textContent();
  const nativeInvalid = await page.$eval('#d-email', (e) => !(e as HTMLInputElement).validity.valid);
  // pick a different slot
  const slots = page.locator('.slot');
  const slotCount = await slots.count();
  if (slotCount > 1) await slots.nth(1).click();
  const email = `qa6-${Date.now()}@example.com`;
  await page.fill('#d-email', email);
  await page.fill('#d-co', 'QA Co');
  await page.fill('#d-msg', 'landing spec <script>x</script>');
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/demo-requests')),
    page.locator('#demo-submit').click(),
  ]);
  await expect(msg).toContainText('Thanks');
  out.demo = { emptyMsg, badEmailMsg, nativeInvalid, slotCount, submitStatus: resp.status(), success: await msg.textContent(), email, nameAfterReset: await page.inputValue('#d-name') };
});

test('sign in goes to /app/', async ({ page }) => {
  await page.goto('/');
  const signin = page.locator('a[href="/app/"]').first();
  out.signinText = await signin.textContent();
  await signin.click();
  await expect(page).toHaveURL(/\/app\//);
  await page.waitForLoadState('networkidle');
  out.signinTitle = await page.title();
});

test('/download/ links (HEAD each)', async ({ page }) => {
  const r = await page.goto('/download/');
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href));
  const res: Record<string, number> = {};
  for (const h of hrefs) res[h] = (await page.request.head(h)).status();
  out.download = { pageStatus: r?.status(), links: res, themeAttr: await page.evaluate(() => document.documentElement.dataset.theme) };
});

test('page weight, layout at width, screenshots', async ({ page }, info) => {
  const reqs: { url: string; type: string; bytes: number; status: number; cache?: string; enc?: string }[] = [];
  page.on('requestfinished', async (req) => {
    const resp = await req.response();
    const sizes = await req.sizes().catch(() => ({ responseBodySize: 0, responseHeadersSize: 0 }));
    reqs.push({ url: req.url(), type: req.resourceType(), bytes: sizes.responseBodySize + sizes.responseHeadersSize, status: resp?.status() ?? 0, cache: resp?.headers()['cache-control'], enc: resp?.headers()['content-encoding'] });
  });
  const t0 = Date.now();
  await page.goto('/', { waitUntil: 'networkidle' });
  const loadMs = Date.now() - t0;
  const timing = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null };
  });
  const overflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll('body *')).filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 8).map((e) => e.tagName + (e.id ? '#' + e.id : '') + ' ' + Math.round(e.getBoundingClientRect().right));
  });
  const imgs = await page.$$eval('img', (is) => is.map((i) => ({ src: (i as HTMLImageElement).currentSrc, w: (i as HTMLImageElement).naturalWidth })));
  const small = await page.$$eval('a,button,input,select,textarea', (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 24 || r.width < 24); }).length);
  await page.screenshot({ path: `screenshots/landing-${info.project.name}.png`, fullPage: true });
  await page.goto('/download/');
  await page.screenshot({ path: `screenshots/download-${info.project.name}.png`, fullPage: true });
  const total = reqs.reduce((a, r) => a + r.bytes, 0);
  out.weight = { requests: reqs.length, totalBytes: total, loadMs, timing, reqs, overflow, wide, imgs, smallTargets: small };
});
