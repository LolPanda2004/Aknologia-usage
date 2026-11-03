// Behaviour checks for the responsive + motion upgrade (PLAN §12 items 2–5).
//   cd tests/responsive && BASE_URL=http://localhost:8080 npx playwright test -c playwright.check.config.ts
// Needs the same servers as audit.spec.ts (desktop checks: Vite :5174 + tests/bin/aknologia-agent.exe).
import { test, expect, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, SERVER, WINDOW, api, codeFor, createOrg, dataOrg, rand, sleep } from './helpers';
import { freshSandbox, restoreRunKey, runKey, startAgent, stopAgent, agentCall, type AgentProc } from '../e2e/member-helpers';

const OUT = path.join(HERE, 'results', 'checks.json');
const results: Record<string, unknown> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const record = (k: string, v: unknown) => { results[k] = v; fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); };
const GROUPS = (process.env.GROUPS ?? 'web,desktop').split(',');

async function ctxFor(browser: Browser, w: number, h: number, init: Record<string, string>, reduced = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w <= 768, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript((kv) => { try { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v as string); } catch { /* */ } }, init);
  return ctx;
}

/** Drawer: aria-expanded, focus inside, Tab never leaves, Shift+Tab wraps, Escape restores focus, backdrop closes, scroll lock, resize closes. */
async function drawerChecks(page: Page, label: string) {
  const btn = page.locator('.menu-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(400);
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('#side-nav'));
  expect(await inside(), `${label}: focus moves into the drawer`).toBe(true);
  for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); expect(await inside(), `${label}: Tab ${i + 1} stays in drawer`).toBe(true); }
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Shift+Tab'); expect(await inside(), `${label}: Shift+Tab stays in drawer`).toBe(true); }
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), `${label}: scroll lock`).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('menu-btn')), `${label}: focus back on menu button`).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), `${label}: scroll lock released`).not.toBe('hidden');
  await btn.click();
  await page.waitForTimeout(400);
  const vw = page.viewportSize()!.width;
  await page.mouse.click(vw - 40, 300); // backdrop (drawer is at most 86vw wide; keep clear of the scrollbar gutter)
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  // choosing a nav item closes it and focuses the page heading
  await btn.click(); await page.waitForTimeout(400);
  await page.locator('#side-nav .nav-item').nth(1).click();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.activeElement?.tagName), `${label}: focus on h1 after navigating`).toBe('H1');
  // resizing to desktop width closes it and clears the lock
  await btn.click(); await page.waitForTimeout(300);
  const sz = page.viewportSize()!;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), `${label}: lock cleared on resize`).not.toBe('hidden');
  await expect(page.locator('.menu-btn')).toBeHidden();
  await page.setViewportSize(sz);
  return 'pass';
}

if (GROUPS.includes('web')) test.describe('web checks', () => {
  for (const [w, h] of [[390, 844], [960, 640]]) {
    test(`admin drawer keyboard ${w}`, async ({ browser }) => {
      const D = await dataOrg();
      const ctx = await ctxFor(browser, w, h, { 'akn-admin-token': D.token, 'akn-admin-toured': '1' });
      const page = await ctx.newPage();
      await page.goto(SERVER + '/app/#/');
      await page.waitForSelector('.kpi');
      record(`drawer-admin-${w}`, await drawerChecks(page, `admin ${w}`));
      await ctx.close();
    });
  }
});

/** Modal/sheet fits the viewport; its primary action is visible and clickable without scrolling. */
async function modalFits(page: Page) {
  return page.evaluate(() => {
    const m = document.querySelector('.overlay:not(.ghost) .modal') as HTMLElement;
    const r = m.getBoundingClientRect();
    const b = m.querySelector('.btn-primary, .btn-danger') as HTMLElement | null;
    const br = b?.getBoundingClientRect();
    const hit = br ? document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2) : null;
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, inside: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= document.documentElement.clientWidth + 0.5,
      sheet: innerWidth < 768 ? Math.abs(r.bottom - innerHeight) < 1.5 : null, actionVisible: !!b && !!hit && b.contains(hit), scrolls: m.scrollHeight > m.clientHeight };
  });
}

if (GROUPS.includes('web')) test.describe('web checks 2', () => {
  for (const [w, h] of [[360, 740], [390, 844], [960, 640], [1440, 900]]) {
    test(`modals fit ${w}x${h}`, async ({ browser }) => {
      const D = await dataOrg();
      const ctx = await ctxFor(browser, w, h, { 'akn-admin-token': D.token, 'akn-admin-toured': '1' });
      const page = await ctx.newPage();
      const out: Record<string, unknown> = {};
      await page.goto(SERVER + '/app/#/settings'); await page.waitForSelector('#security .btn');
      await page.getByRole('button', { name: 'Change password' }).click(); await page.waitForTimeout(500);
      out.password = await modalFits(page);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      expect(await page.evaluate(() => document.activeElement?.textContent), 'focus returns to the trigger').toContain('Change password');
      await page.goto(SERVER + '/app/#/members'); await page.waitForSelector('table');
      await page.getByRole('button', { name: 'Invite members' }).click(); await page.waitForTimeout(500);
      expect(await page.evaluate(() => document.activeElement?.id), 'first field focused').toBe('inv-emails');
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('.modal')), 'Tab stays in modal').toBe(true); }
      out.invite = await modalFits(page);
      record(`modals-${w}x${h}`, out);
      for (const k of ['password', 'invite']) {
        const r = out[k] as any;
        expect(r.inside, `${k} inside viewport`).toBe(true);
        expect(r.actionVisible, `${k} primary action visible`).toBe(true);
        if (r.sheet !== null) expect(r.sheet, `${k} sheet sits on the bottom edge`).toBe(true);
      }
      await ctx.close();
    });
  }

  test('reduced motion: no animation runs, KPI final on first frame, no reveal', async ({ browser }) => {
    const D = await dataOrg();
    const ctx = await ctxFor(browser, 1440, 900, { 'akn-admin-token': D.token, 'akn-admin-toured': '1' }, true);
    const page = await ctx.newPage();
    await page.goto(SERVER + '/app/#/');
    await page.waitForSelector('.kpi .value');
    const first = await page.evaluate(() => ({ countUp: document.querySelectorAll('.kpi .value [aria-hidden="true"]').length, anim: document.querySelectorAll('.bars.anim, .line-cover').length,
      long: document.getAnimations().map((a) => Number((a.effect as KeyframeEffect).getComputedTiming().duration)).filter((d) => d > 0.01).length }));
    await page.getByRole('button', { name: 'Refresh data' }).click(); await page.waitForTimeout(150);
    const afterRefresh = await page.evaluate(() => document.getAnimations().map((a) => Number((a.effect as KeyframeEffect).getComputedTiming().duration)).filter((d) => d > 0.01).length);
    await page.goto(SERVER + '/'); await page.waitForTimeout(500);
    const landing = await page.evaluate(() => ({ revealOn: document.documentElement.classList.contains('reveal-on'), long: document.getAnimations().filter((a) => Number((a.effect as KeyframeEffect).getComputedTiming().duration) > 0.01).length }));
    record('reduced-motion', { first, afterRefresh, landing });
    expect(first.countUp).toBe(0); expect(first.anim).toBe(0); expect(first.long).toBe(0); expect(afterRefresh).toBe(0);
    expect(landing.revealOn).toBe(false); expect(landing.long).toBe(0);
    await ctx.close();
  });

  test('no replay after admin Refresh data', async ({ browser }) => {
    const D = await dataOrg();
    const ctx = await ctxFor(browser, 1440, 900, { 'akn-admin-token': D.token, 'akn-admin-toured': '1' });
    const page = await ctx.newPage();
    await page.goto(SERVER + '/app/#/');
    await page.waitForSelector('.kpi .value'); await page.waitForTimeout(1600);
    const kpis = await page.locator('.kpi .value').allInnerTexts();
    await page.getByRole('button', { name: 'Refresh data' }).click();
    await expect(page.getByRole('button', { name: 'Refresh data' })).toBeEnabled({ timeout: 30_000 });
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => ({ chartAnims: document.getAnimations().filter((a) => { const t = (a.effect as KeyframeEffect).target as Element | null; return !!t?.closest('.bars, .kpi, svg, .page'); }).length,
      animClasses: document.querySelectorAll('.bars.anim, .line-cover, .kpi .value [aria-hidden="true"], .skeleton-page').length }));
    const kpis2 = await page.locator('.kpi .value').allInnerTexts();
    record('no-replay-admin-refresh', { ...r, kpisSame: JSON.stringify(kpis) === JSON.stringify(kpis2) });
    expect(r.chartAnims).toBe(0); expect(r.animClasses).toBe(0);
    await ctx.close();
  });
});

if (GROUPS.includes('desktop')) test.describe.serial('desktop checks', () => {
  let agent: AgentProc | undefined;
  let regBefore: string | null = null;
  test.beforeAll(async () => {
    regBefore = runKey();
    const f = path.join(HERE, 'registry-before.txt');
    if ((!regBefore || regBefore.toLowerCase().includes('tests\\bin')) && fs.existsSync(f)) regBefore = fs.readFileSync(f, 'utf8').trim() || null;
    freshSandbox();
    agent = await startAgent();
    const admin = await createOrg('resp-check');
    await api('POST', '/admin/billing/seats', { seats: 10, plan: 'team' }, admin.token);
    const member = `resp-check-${rand()}@example.test`;
    await api('POST', '/admin/members/invite', { emails: [member], role: 'member', budgetCents: 2000 }, admin.token);
    const code = await codeFor(member, 'invite');
    const acc = await agentCall(agent, '/auth/accept-invite', 'POST', { email: member, code, password: 'Memb3r!check-' + rand() });
    if (acc.status !== 200) throw new Error('accept ' + JSON.stringify(acc.data));
    for (let i = 0; i < 80; i++) { const s = await agentCall(agent, '/summary?days=30'); if (s.data.sessions > 0) break; await sleep(1000); }
  });
  test.afterAll(async () => { await stopAgent(agent); restoreRunKey(regBefore); });

  test('desktop drawer keyboard 390 (window is compact-sidebar from 768)', async ({ browser }) => {
    const ctx = await ctxFor(browser, 390, 844, { 'akn-agent-token': agent!.token, 'akn-desk-toured': '1' });
    const page = await ctx.newPage();
    await page.goto(`${WINDOW}/?token=${agent!.token}#/`);
    await page.waitForSelector('.kpi');
    record('drawer-desktop-390', await drawerChecks(page, 'desktop 390'));
    await page.setViewportSize({ width: 960, height: 640 });
    await page.waitForTimeout(300);
    const side = await page.evaluate(() => { const s = document.querySelector('#side-nav')!.getBoundingClientRect(); return { w: Math.round(s.width), menu: getComputedStyle(document.querySelector('.menu-btn')!).display }; });
    expect(side.w).toBe(220);
    expect(side.menu).toBe('none');
    record('desktop-960-compact-sidebar', side);
    await ctx.close();
  });

  test('no replay across the 30 s status poll (desktop Overview)', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await ctxFor(browser, 1320, 880, { 'akn-agent-token': agent!.token, 'akn-desk-toured': '1' });
    const page = await ctx.newPage();
    await page.goto(`${WINDOW}/?token=${agent!.token}#/`);
    await page.waitForSelector('.kpi .value'); await page.waitForTimeout(1600);
    const kpis = await page.locator('.kpi .value').allInnerTexts();
    // count /status calls to prove the poll happened
    let polls = 0; page.on('request', (r) => { if (r.url().includes('/v1/status')) polls++; });
    const seen: number[] = [];
    for (let t = 0; t < 31; t++) {
      seen.push(await page.evaluate(() => document.getAnimations().filter((a) => { const el = (a.effect as KeyframeEffect).target as Element | null; return !!el?.closest('.bars, .kpi, .heat, svg, .page, .skeleton-page'); }).length));
      await page.waitForTimeout(1000);
    }
    const kpis2 = await page.locator('.kpi .value').allInnerTexts();
    const cls = await page.evaluate(() => document.querySelectorAll('.bars.anim, .kpi .value [aria-hidden="true"], .skeleton-page').length);
    record('no-replay-desktop-poll', { polls, maxAnimations: Math.max(...seen), animClasses: cls, kpisSame: JSON.stringify(kpis) === JSON.stringify(kpis2) });
    expect(polls).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBe(0);
    expect(cls).toBe(0);
    await ctx.close();
  });
});
