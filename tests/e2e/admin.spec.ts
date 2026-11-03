// Admin console end-to-end (QA subagent 3).
//   cd tests/e2e && npx playwright test -c playwright.admin.config.ts
// Two suites:
//   1. "full flow"  – every admin flow through the UI, with API/DB cross-checks (light 1440 by default; FULL_ALL=1 for all).
//   2. "pages pass" – in every theme × viewport: auth screens, tour, every page (empty + with data), modals,
//      full-page screenshots, console errors, horizontal overflow, overview numbers vs API.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import {
  MEMBER_PW, PW1, PW2, PW3, acceptDesktop, codeCount, api, apiMember, apiSignup, checkOverviewAgainstApi, expected, fillOtp, guard, ingest, kpi,
  meta, overflow, psql, qaEmail, rand, session, shot, toastText, usd, usdR, withCode, type Ev, type Guard,
} from './admin-helpers';

const TOUR = ['sync', 'alerts', 'kpis', 'help-theme', 'nav-account'];

async function newPage(browser: Browser, info: TestInfo, theme: string): Promise<{ ctx: BrowserContext; page: Page; g: Guard }> {
  const m = info.project.metadata as { theme: 'light' | 'dark'; width: number; height: number };
  const ctx = await browser.newContext({
    baseURL: (info.project.use as any).baseURL, viewport: { width: m.width, height: m.height }, colorScheme: m.theme,
    locale: 'en-US', timezoneId: 'UTC', acceptDownloads: true,
  });
  await ctx.addInitScript((t) => { try { if (!localStorage.getItem('akn-theme')) localStorage.setItem('akn-theme', t); } catch { /* */ } }, theme);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  return { ctx, page, g: guard(page) };
}

// Product-level checks are recorded as findings (annotations) instead of failing the step, so the serial flow keeps going;
// each suite ends with a "findings" test that fails if any check failed.
const FINDINGS: string[] = [];
async function chk(fn: () => Promise<void>) {
  try { await fn(); } catch (e: any) {
    const msg = String(e?.message ?? e).replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim()).slice(0, 6).join(' | ');
    const info = test.info();
    FINDINGS.push(`[${info.project.name}] ${info.titlePath.slice(1).join(' > ')}: ${msg}`);
    info.annotations.push({ type: 'finding', description: msg });
  }
}

/** Records any console error collected since the last call, then clears the list. */
async function noConsoleErrors(g: Guard, where: string) {
  const errs = g.errors.splice(0);
  await chk(async () => { await expect(errs, `console errors during ${where}`).toEqual([]); });
}

async function layoutOk(page: Page, where: string) {
  const o = await overflow(page);
  await chk(async () => { await expect(o, `horizontal page overflow on ${where}`).toEqual([]); });
}

async function themeOk(page: Page, theme: string) {
  await chk(async () => { await expect(await page.evaluate(() => document.documentElement.dataset.theme), 'data-theme').toBe(theme); });
}

const token = (page: Page) => page.evaluate(() => localStorage.getItem('akn-admin-token')) as Promise<string>;
const isWide = (info: TestInfo) => meta(info).width > 860;

/** Navigates with the sidebar when it exists; on phones the sidebar is hidden so the hash is used (recorded as a finding). */
async function nav(page: Page, info: TestInfo, label: string, hash: string) {
  const btn = page.locator('nav.side').getByRole('button', { name: label, exact: true });
  if (await btn.isVisible()) await btn.click();
  else await page.evaluate((h) => { window.location.hash = h; }, hash);
  await expect(page.locator('h1')).toBeVisible();
}

async function tourCheck(page: Page, info: TestInfo, prefix: string) {
  const card = page.locator('.tour-card');
  await expect(card).toBeVisible({ timeout: 8000 });
  for (let i = 0; i < TOUR.length; i++) {
    await expect(card).toContainText(`STEP ${i + 1} OF ${TOUR.length}`);
    await page.waitForTimeout(900);
    const r = await page.evaluate((t) => {
      // D3 (responsive upgrade): when the step's target sits in the closed drawer the tour highlights the menu button instead
      const el = (document.querySelector('.tour-target') ?? document.querySelector(`[data-tour="${t}"]`)) as HTMLElement | null;
      const c = (document.querySelector('.tour-card') as HTMLElement).getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const cardInView = c.left >= 0 && c.right <= vw + 1 && c.top >= 0 && c.bottom <= vh + 1;
      if (!el) return { exists: false, cardInView };
      const b = el.getBoundingClientRect();
      const visible = b.width > 0 && b.height > 0;
      const inView = visible && b.bottom > 0 && b.top < vh && b.right > 0 && b.left < vw;
      let onTop = false, hitCls = '';
      if (inView) {
        const x = Math.min(vw - 2, Math.max(1, b.left + Math.min(b.width / 2, 30))), y = Math.min(vh - 2, Math.max(1, b.top + Math.min(b.height / 2, 20)));
        const hit = document.elementFromPoint(x, y) as HTMLElement | null;
        onTop = !!hit && (hit === el || el.contains(hit));
        hitCls = hit ? hit.tagName + '.' + hit.className : '';
      }
      const ix = Math.max(0, Math.min(c.right, b.right) - Math.max(c.left, b.left)), iy = Math.max(0, Math.min(c.bottom, b.bottom) - Math.max(c.top, b.top));
      const covers = ix * iy > 0.25 * Math.min(b.width * b.height, c.width * c.height);
      // ADM-02: the card's buttons must receive clicks (on phones the card docks at the bottom, over tall targets)
      const btns = [...document.querySelectorAll('.tour-card button')] as HTMLElement[];
      const buttonsClickable = btns.length > 0 && btns.every((bt) => { const q = bt.getBoundingClientRect(); const h = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!h && (h === bt || bt.contains(h)); });
      return { exists: true, visible, inView, onTop, hitCls, covers, cardInView, buttonsClickable, phone: vw < 768 };
    }, TOUR[i]);
    await chk(async () => { await expect(r.exists, `tour step ${i + 1} target [data-tour=${TOUR[i]}] exists`).toBe(true); });
    await chk(async () => { await expect(r.visible, `tour step ${i + 1} target ${TOUR[i]} is visible (non-zero size)`).toBe(true); });
    await chk(async () => { await expect(r.inView, `tour step ${i + 1} target ${TOUR[i]} in viewport`).toBe(true); });
    await chk(async () => { await expect(r.onTop, `tour step ${i + 1} target ${TOUR[i]} is highlighted above the dim layer (hit: ${(r as any).hitCls})`).toBe(true); });
    await chk(async () => { await expect((r as any).buttonsClickable, `tour step ${i + 1} card buttons can be clicked`).toBe(true); });
    await chk(async () => { await expect(r.covers && !(r as any).phone, `tour step ${i + 1} card does not cover its target ${TOUR[i]} (allowed on phones, where it docks)`).toBe(false); });
    await chk(async () => { await expect(r.cardInView, `tour step ${i + 1} card fully inside the viewport`).toBe(true); });
    await shot(page, info, `${prefix}tour-${i + 1}`);
    const next = card.getByRole('button', { name: i === TOUR.length - 1 ? 'Done' : 'Next' });
    let clickable = true;
    try { await next.click({ trial: true, timeout: 3000 }); } catch { clickable = false; }
    await chk(async () => { await expect(clickable, `tour step ${i + 1} (${TOUR[i]}): Next/Done button can be clicked (not covered by the highlighted target)`).toBe(true); });
    if (clickable) await next.click(); else await next.evaluate((b) => (b as HTMLButtonElement).click());
  }
  await expect(card).toBeHidden();
  await chk(async () => { await expect(await page.locator('.tour-target').count(), 'tour highlight removed').toBe(0); });
}

function writeNotes(info: TestInfo, notes: Record<string, unknown>) {
  const dir = path.join(__dirname, 'test-results-admin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `notes-${info.project.name}-${info.title.replace(/\W+/g, '_').slice(0, 40)}.json`), JSON.stringify(notes, null, 2));
}

async function memberId(tok: string, email: string) {
  const r = await api('GET', '/admin/members', undefined, tok);
  return r.data.members.find((m: any) => m.email === email)?.id as string;
}

// =====================================================================================================================
// 1. FULL FLOW
// =====================================================================================================================
test.describe('full flow', () => {
  test.describe.configure({ mode: 'serial' });
  let ctx: BrowserContext, page: Page, g: Guard;
  const S: any = { admin: { email: qaEmail('admin'), name: 'Avery Admin', company: 'QA3 Flow ' + rand() }, m: {} as Record<string, string>, tok: {} as Record<string, string>, ev: {} as Record<string, Ev[]> };
  for (const k of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) S.m[k] = qaEmail(k);
  const notes: Record<string, unknown> = {};

  test.beforeAll(async ({ browser }, info) => {
    test.skip(!process.env.FULL_ALL && info.project.name !== 'admin-light-1440', 'full flow runs in light-1440 (set FULL_ALL=1 for all)');
    ({ ctx, page, g } = await newPage(browser, info, meta(info).theme));
  });
  test.beforeEach(async ({}, info) => { test.skip(!process.env.FULL_ALL && info.project.name !== 'admin-light-1440'); });
  test.afterAll(async ({}, info) => { if (ctx) { writeNotes(info, notes); await ctx.close(); } });

  test('sign up with the emailed code', async ({}, info) => {
    await page.goto('/app/#/signup');
    await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
    await page.locator('#su-name').fill(S.admin.name);
    await page.locator('#su-email').fill(S.admin.email);
    await page.locator('#su-co').fill(S.admin.company);
    await page.locator('#su-size').selectOption('1 – 10');
    await page.locator('#su-pw').fill(PW1);
    await shot(page, info, 'flow-signup');
    const code = await withCode(S.admin.email, 'otp:verify_signup', async () => {
      await page.getByRole('button', { name: 'Create workspace', exact: true }).last().click();
      await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    });
    await expect(page.locator('body')).toContainText(S.admin.email[0] + '•••••@example.test');
    await fillOtp(page, code);
    await page.getByRole('button', { name: 'Verify and open my workspace' }).click();
    await expect(page.locator('h1')).toHaveText('Team overview');
    S.token = await token(page);
    expect(S.token).toBeTruthy();
    await noConsoleErrors(g, 'signup');
  });

  test('in-app tour: every step points at a real, visible element; replay from help', async ({}, info) => {
    await tourCheck(page, info, 'flow-');
    await page.getByRole('button', { name: 'Start the tour' }).click();
    await expect(page.locator('.tour-card')).toBeVisible();
    await page.locator('.tour-card').getByRole('button', { name: 'Skip' }).click();
    await expect(page.locator('.tour-card')).toBeHidden();
    // theme toggle persists
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.locator('.topbar').getByRole('button', { name: /Switch to (dark|light) mode/ }).click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(before);
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
    await page.locator('.topbar').getByRole('button', { name: /Switch to (dark|light) mode/ }).click();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(before);
    await chk(async () => { await expect(await page.locator('.tour-card').count(), 'tour does not re-open after reload').toBe(0); });
    await noConsoleErrors(g, 'tour');
  });

  test('fresh org: overview empty states and numbers match the API', async ({}, info) => {
    const { mismatches, d } = await checkOverviewAgainstApi(page, S.token);
    await chk(async () => { await expect(mismatches).toEqual([]); });
    expect(d.kpis.spend).toBe(0);
    for (const t of ['Not enough data yet', 'Everyone is under 80% of their budget.']) await chk(async () => { await expect(page.getByText(t)).toBeVisible(); });
    await chk(async () => { await expect(page.getByText('No usage yet', { exact: true })).toBeVisible(); });
    await chk(async () => { await expect(page.locator('section.card', { hasText: 'Daily active members' }).getByText('No activity yet', { exact: true })).toBeVisible(); });
    notes.freshOverviewMembers = d.members.map((m: any) => m.status);
    await shot(page, info, 'flow-overview-empty');
    await noConsoleErrors(g, 'empty overview');
  });

  test('set plan and seats', async ({}, info) => {
    await nav(page, info, 'Settings and billing', '/settings');
    await page.getByRole('button', { name: 'Change plan or seats' }).click();
    const dlg = page.getByRole('dialog', { name: 'Change plan or seats' });
    await expect(dlg).toBeVisible();
    await shot(page, info, 'flow-plan-modal');
    await dlg.locator('#pl').selectOption('team');
    await dlg.locator('#st').fill('10');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator(".toast")).toHaveText('Plan updated');
    const billing = page.locator('#billing');
    await expect(billing).toContainText('Team');
    await expect(billing).toContainText('× 10 seats');
    await expect(billing).toContainText('$90');
    // sidebar plan card should follow
    await chk(async () => { await expect(page.locator('.side-foot'), 'sidebar plan card updates after plan change (no reload)').toContainText('TEAM PLAN', { timeout: 2000 }); });
    notes.sidebarAfterPlan = await page.locator('.side-foot').innerText();
    // API: invalid starter change must not change the plan
    const bad = await api('POST', '/admin/billing/seats', { seats: 9, plan: 'starter' }, S.token);
    expect(bad.status).toBe(400);
    const b = await api('GET', '/admin/billing', undefined, S.token);
    notes.planAfterRejectedStarter = b.data.plan;
    await chk(async () => { await expect(b.data.plan, 'rejected Starter/9-seat change leaves plan unchanged').toBe('team'); });
    await api('POST', '/admin/billing/seats', { seats: 10, plan: 'team' }, S.token);
    await noConsoleErrors(g, 'plan and seats');
  });

  test('invite members: chips, paste a list, budget, role', async ({}, info) => {
    await nav(page, info, 'Members', '/members');
    await page.getByRole('button', { name: 'Invite members' }).click();
    const dlg = page.getByRole('dialog', { name: 'Invite members' });
    const input = dlg.locator('#inv-emails');
    await input.fill(S.m.m1); await input.press('Enter');
    await input.fill(S.m.m2); await input.press(',');
    await input.fill('junk-' + rand() + '@example.test'); await input.press(' ');
    await input.evaluate((el, text) => {
      const dt = new DataTransfer(); dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, `${S.m.m3}, ${S.m.m4.toUpperCase()}\n${S.m.m5}; not-an-email`);
    const chips = dlg.locator('.pill-accent');
    await expect(chips).toHaveCount(6);
    await chips.filter({ hasText: 'junk-' }).getByRole('button').click();
    await expect(chips).toHaveCount(5);
    await expect(chips.filter({ hasText: S.m.m4 })).toHaveCount(1); // lower-cased
    await dlg.locator('#inv-budget').fill('25abc');
    await expect(dlg.locator('#inv-budget')).toHaveValue('25');
    await expect(dlg.getByText('9 seats left')).toBeVisible();
    await shot(page, info, 'flow-invite-modal');
    const codes: Record<string, number> = {};
    await dlg.getByRole('button', { name: 'Send 5 invites' }).click();
    await expect(page.locator(".toast")).toHaveText('5 invites sent');
    // admin invite through the un-committed draft path
    await page.getByRole('button', { name: 'Invite members' }).click();
    await dlg.locator('#inv-emails').fill(S.m.m6);
    await dlg.locator('#inv-role').selectOption('admin');
    const sendBtn = dlg.getByRole('button', { name: /^Send 1 invite/ });
    notes.singleDraftInviteLabel = (await sendBtn.innerText()).trim();
    await chk(async () => { await expect(notes.singleDraftInviteLabel, 'button label for one typed (draft) email').toBe('Send 1 invite'); });
    await sendBtn.click();
    await expect(page.locator(".toast")).toHaveText('1 invite sent');
    for (const k of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) codes[k] = codeCount(S.m[k], 'invite');
    expect(Object.values(codes).every((n) => n === 1), 'one invite code per invitee in the log').toBe(true);
    for (const k of ['m1', 'm2', 'm3', 'm4', 'm5']) {
      const row = page.locator('tbody tr', { hasText: S.m[k] });
      await expect(row).toContainText('Invite pending');
      await expect(row).toContainText('$25');
      await expect(row).toContainText('custom');
      await expect(row).toContainText('Member');
    }
    await expect(page.locator('tbody tr', { hasText: S.m.m6 })).toContainText('Admin');
    expect((await kpi(page, 'Seats used')).value).toBe('7 of 10');
    expect((await kpi(page, 'Pending invites')).value).toBe('6');
    await shot(page, info, 'flow-members-invited');
    await noConsoleErrors(g, 'invite');
  });

  test('resend and cancel invites', async ({}, info) => {
    const oldCode = codeCount(S.m.m5, 'invite');
    expect(oldCode).toBe(1);
    const logTxt = fs.readFileSync(path.join(__dirname, '..', '.server.log'), 'utf8');
    const first = [...logTxt.matchAll(new RegExp(`invite code for ${S.m.m5.replace(/[.+]/g, '\\$&')}: ([A-Z0-9-]+)`, 'g'))][0][1];
    const newCode = await withCode(S.m.m5, 'invite', async () => {
      await page.locator('tbody tr', { hasText: S.m.m5 }).getByRole('button', { name: 'Resend invite' }).click();
      await expect(page.locator(".toast")).toHaveText(`Invite resent to ${S.m.m5}`);
    });
    expect(newCode).not.toBe(first);
    const old = await api('POST', '/auth/invite/accept', { email: S.m.m5, code: first, password: MEMBER_PW, client: 'desktop' });
    await chk(async () => { await expect(old.status, 'old invite code is invalid after resend').toBe(400); });
    await page.locator('tbody tr', { hasText: S.m.m4 }).getByRole('button', { name: 'Cancel invite' }).click();
    await expect(page.locator(".toast")).toHaveText('Invite cancelled');
    await expect(page.locator('tbody tr', { hasText: S.m.m4 })).toHaveCount(0);
    expect((await kpi(page, 'Seats used')).value).toBe('6 of 10');
    await noConsoleErrors(g, 'resend/cancel');
  });

  test('members accept, usage ingested (API), Refresh data', async ({}, info) => {
    const log = fs.readFileSync(path.join(__dirname, '..', '.server.log'), 'utf8');
    const inv = (e: string) => [...log.matchAll(new RegExp(`invite code for ${e.replace(/[.+]/g, '\\$&')}: ([A-Z0-9-]+)`, 'g'))].pop()![1];
    for (const k of ['m1', 'm2', 'm3']) S.tok[k] = await acceptDesktop(S.m[k], inv(S.m[k]));
    S.ev.m1 = [...session('claude_code', 'claude-opus-4-1', 35, 120, 80, { input: 1000, output: 20000, cacheWrite: 2000, cacheRead: 50000 }),
      ...session('codex', 'gpt-5-codex', 3, 60, 20, { input: 10000, output: 5000, cacheWrite: 0, cacheRead: 20000 })];
    S.ev.m2 = session('claude_code', 'claude-sonnet-4-5', 4, 180, 30, { input: 2000, output: 3000, cacheWrite: 0, cacheRead: 10000 });
    S.ev.m3 = session('claude_code', 'claude-haiku-4-5', 2, 60, 10, { input: 1000, output: 1000, cacheWrite: 0, cacheRead: 0 });
    for (const k of ['m1', 'm2', 'm3']) expect((await ingest(S.tok[k], S.ev[k])).accepted).toBe(S.ev[k].length);
    const dup = await ingest(S.tok.m2, S.ev.m2);
    expect(dup.duplicates, 'resending a batch is deduplicated').toBe(S.ev.m2.length);
    for (const k of ['m1', 'm2', 'm3', 'm5', 'm6']) S.id = { ...(S.id ?? {}), [k]: await memberId(S.token, S.m[k]) };
    await page.locator('[data-tour="sync"]').click();
    await expect(page.locator(".toast")).toHaveText('Refreshed 44 events from the database');
    await expect(page.locator('.page-head')).toContainText('Refreshed from database just now');
    await noConsoleErrors(g, 'refresh');
  });

  test('overview numbers match the API and independent math', async ({}, info) => {
    await nav(page, info, 'Team overview', '/');
    await expect(page.getByText('Spend by model')).toBeVisible();
    const { mismatches, d } = await checkOverviewAgainstApi(page, S.token);
    await chk(async () => { await expect(mismatches, 'overview UI vs API').toEqual([]); });
    const all = [...S.ev.m1, ...S.ev.m2, ...S.ev.m3];
    const e = { m1: expected(S.ev.m1), m2: expected(S.ev.m2), m3: expected(S.ev.m3) };
    const tot = { cost: e.m1.costMicros + e.m2.costMicros + e.m3.costMicros, saved: e.m1.savedMicros + e.m2.savedMicros + e.m3.savedMicros, act: e.m1.activeSec + e.m2.activeSec + e.m3.activeSec };
    const k = d.kpis;
    await chk(async () => { await expect(k.spend, 'team spend = sum of tokens × list price').toBeCloseTo(usdR(tot.cost), 2); });
    await chk(async () => { await expect(k.saved, 'saved by caching').toBeCloseTo(usdR(tot.saved), 2); });
    await chk(async () => { await expect(k.activeHours, 'active hours').toBe(Math.round(tot.act / 360) / 10); });
    await chk(async () => { await expect(k.activeMembers).toBe(3); });
    await chk(async () => { await expect(k.members, 'members = active + invited (not removed)').toBe(6); });
    await chk(async () => { await expect(k.pendingInvites).toBe(2); });
    await chk(async () => { await expect(k.costPerHour).toBeCloseTo(Math.round((usdR(tot.cost) / (tot.act / 3600)) * 100) / 100, 2); });
    const ein = all.reduce((a, x) => a + x.input + x.cacheRead + x.cacheWrite, 0), ecr = all.reduce((a, x) => a + x.cacheRead, 0);
    await chk(async () => { await expect(k.cacheShare).toBe(Math.round((ecr / ein) * 100)); });
    await chk(async () => { await expect(k.budgets, 'sum of budgets: 5×$25 + $150 default for admin & m6… (invited count)').toBe(25 * 4 + 150 * 2); });
    const row1 = d.members.find((m: any) => m.email === S.m.m1);
    await chk(async () => { await expect(row1.spend).toBeCloseTo(usdR(e.m1.costMicros), 2); });
    await chk(async () => { await expect(row1.status).toBe('Over budget'); });
    await chk(async () => { await expect(row1.pct).toBe(Math.round((usdR(e.m1.costMicros) / 25) * 100)); });
    await chk(async () => { await expect(row1.claudeShare).toBe(Math.round((e.m1.claudeMicros / e.m1.costMicros) * 100)); });
    await chk(async () => { await expect(d.alerts.over).toContain(S.m.m1); });
    await chk(async () => { await expect(d.costPerHour.length, 'm1 has > 1 h active → cost per hour row').toBe(1); });
    await chk(async () => { await expect(d.dataHealth.devices).toBe(3); });
    await chk(async () => { await expect(d.dataHealth.synced2h).toBe(3); });
    notes.overviewKpis = k;
    notes.expected = { cost: usdR(tot.cost), saved: usdR(tot.saved), activeH: tot.act / 3600 };
    await expect(page.locator('[data-tour="alerts"]')).toContainText('1 over budget and 0 close');
    await shot(page, info, 'flow-overview');
    // last month = empty
    await page.getByRole('group', { name: 'Month' }).getByRole('button', { name: 'Last month' }).click();
    await expect(page.locator('.kpi').first()).toBeVisible();
    await chk(async () => { await expect((await kpi(page, 'Team spend')).value).toBe('$0.00'); });
    await page.getByRole('group', { name: 'Month' }).getByRole('button', { name: 'This month' }).click();
    await expect(page.locator('.kpi').first()).toContainText(usd(k.spend));
    await noConsoleErrors(g, 'overview with data');
  });

  test('member detail', async ({}, info) => {
    await page.locator(`a[href="#/members/${S.id.m1}"]`).first().click();
    await expect(page.locator('h1')).toHaveText('Member detail');
    const { data: d } = await api('GET', `/admin/members/${S.id.m1}/usage`, undefined, S.token);
    const e = expected(S.ev.m1);
    await chk(async () => { await expect(d.kpis.spend).toBeCloseTo(usdR(e.costMicros), 2); });
    await chk(async () => { await expect(d.kpis.sessions).toBe(2); });
    await chk(async () => { await expect((await kpi(page, 'Spend')).value).toBe(usd(d.kpis.spend)); });
    await chk(async () => { await expect((await kpi(page, 'Sessions')).value).toBe(String(d.kpis.sessions)); });
    await chk(async () => { await expect((await kpi(page, 'Active coding time')).value).toBe(`${d.kpis.activeHours} h`); });
    await chk(async () => { await expect((await kpi(page, 'Cost per active hour')).value).toBe(usd(d.kpis.costPerHour)); });
    await chk(async () => { await expect((await kpi(page, 'Served from cache')).value).toBe(`${d.kpis.cacheShare}%`); });
    const b = d.budget;
    await chk(async () => { await expect(page.locator('section.card').first()).toContainText(`${usd(b.spentCents / 100)} of ${usd(b.budgetCents / 100, 0)} · ${b.pct}%`); });
    // overview pct (float cents) vs member pct (integer cents) consistency
    const ov = await api('GET', '/admin/overview', undefined, S.token);
    notes.pctOverviewVsDetail = [ov.data.members.find((m: any) => m.email === S.m.m1).pct, b.pct];
    await chk(async () => { await expect(b.pct, 'member detail % = overview %').toBe(ov.data.members.find((m: any) => m.email === S.m.m1).pct); });
    await chk(async () => { await expect(page.getByText('Alerts sent: ')).toBeVisible(); });
    await expect(page.getByText('QA laptop · macOS 15')).toBeVisible();
    await expect(page.locator('section.card', { hasText: 'Recent sessions' }).locator('tbody tr')).toHaveCount(2);
    await expect(page.getByText('Over budget').first()).toBeVisible();
    await shot(page, info, 'flow-member');
    await page.getByRole('button', { name: 'Back to members' }).click();
    await expect(page.locator('h1')).toHaveText('Members');
    await noConsoleErrors(g, 'member detail');
  });

  test('edit budget, remove with and without history, re-invite', async ({}, info) => {
    await page.locator('tbody tr', { hasText: S.m.m1 }).getByRole('button', { name: 'Edit budget' }).click();
    const bd = page.getByRole('dialog', { name: /Monthly budget for/ });
    await expect(bd.locator('#mb-v')).toHaveValue('25');
    await shot(page, info, 'flow-budget-modal');
    await bd.locator('#mb-v').fill('30');
    await bd.getByRole('button', { name: 'Save budget' }).click();
    await expect(page.locator(".toast")).toContainText('Budget updated for');
    await expect(page.locator('tbody tr', { hasText: S.m.m1 })).toContainText('$30');
    // remove m2 keeping history
    await page.locator('tbody tr', { hasText: S.m.m2 }).getByRole('button', { name: 'Remove' }).click();
    const rd = page.getByRole('alertdialog');
    await expect(rd).toBeVisible();
    await expect(rd.getByRole('checkbox')).not.toBeChecked();
    await shot(page, info, 'flow-remove-modal');
    notes.removeButtonLabel = (await rd.getByRole('button', { name: /^Remove and email/ }).innerText()).trim();
    await rd.getByRole('button', { name: /^Remove and email/ }).click();
    await expect(page.locator(".toast")).toContainText('was removed and emailed');
    await expect(page.locator('tbody tr', { hasText: S.m.m2 })).toContainText('Removed');
    expect(Number(psql(`SELECT count(*) FROM usage_events WHERE user_id = '${S.id.m2}'`)), 'history kept').toBe(4);
    const cfg = await api('GET', '/agent/config', undefined, S.tok.m2);
    expect(cfg.status, 'removed member device is told to stop').toBe(403);
    // remove m3 with history
    await page.locator('tbody tr', { hasText: S.m.m3 }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('alertdialog').getByRole('checkbox').check();
    await page.getByRole('alertdialog').getByRole('button', { name: /^Remove and email/ }).click();
    await expect(page.locator(".toast")).toContainText('was removed and emailed');
    const id3 = await memberId(S.token, S.m.m3);
    expect(Number(psql(`SELECT count(*) FROM usage_events WHERE user_id = '${id3}'`)), 'history deleted').toBe(0);
    expect(Number(psql(`SELECT count(*) FROM daily_usage WHERE user_id = '${id3}'`))).toBe(0);
    expect((await kpi(page, 'Removed this month')).value).toBe('2');
    await page.getByRole('button', { name: 'Removed · 2' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await shot(page, info, 'flow-members-removed');
    await page.locator('tbody tr', { hasText: S.m.m2 }).getByRole('button', { name: 'Re-invite' }).click();
    await expect(page.locator(".toast")).toHaveText(`Re-invited ${S.m.m2}`);
    await page.getByRole('button', { name: /^All · / }).click();
    await expect(page.locator('tbody tr', { hasText: S.m.m2 })).toContainText('Invite pending');
    // overview after removals: team spend vs member rows
    const ov = (await api('GET', '/admin/overview', undefined, S.token)).data;
    const rowsSum = ov.members.reduce((a: number, m: any) => a + m.spend, 0);
    notes.afterRemoval = { teamSpend: ov.kpis.spend, sumOfRows: Math.round(rowsSum * 100) / 100, m2kept: usdR(expected(S.ev.m2).costMicros) };
    await noConsoleErrors(g, 'remove');
  });

  test('budgets: default, override, inboxes, toggles, save, alert log', async ({}, info) => {
    await nav(page, info, 'Budgets and alerts', '/budgets');
    await expect(page.getByText('Alert log')).toBeVisible();
    notes.alertLogAfterBudgetChange = await page.locator('section.card', { hasText: 'Alert log' }).innerText();
    await page.locator('[data-tour="sync"]').click();
    await toastText(page);
    const log = page.locator('section.card', { hasText: 'Alert log' });
    await chk(async () => { await expect(log).toContainText('reached 100%'); });
    await chk(async () => { await expect(log).toContainText('reached 80%'); });
    await page.locator('#def-budget').fill('200');
    await page.getByLabel(`Budget for ${S.m.m6}`).fill('75');
    await page.getByLabel(`Budget for ${S.m.m1}`).fill('');
    const add = page.getByLabel('Add an alert inbox');
    const fin = 'finance-' + rand() + '@example.test', ops = 'ops-' + rand() + '@example.test';
    await add.fill(fin); await add.press('Enter');
    await add.fill(ops); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: `Remove ${S.admin.email}` }).click();
    await page.locator('#rw').uncheck();
    await page.locator('#rm').check();
    await shot(page, info, 'flow-budgets-edited');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator(".toast")).toHaveText('Budgets saved');
    const b = (await api('GET', '/admin/budgets', undefined, S.token)).data;
    await chk(async () => { await expect(b.defaultBudget).toBe(200); });
    await chk(async () => { await expect(b.inboxes).toEqual([fin, ops]); });
    await chk(async () => { await expect(b.weeklySummary).toBe(false); });
    await chk(async () => { await expect(b.emailMemberAt100).toBe(true); });
    await chk(async () => { await expect(b.alert80 && b.alert100).toBe(true); });
    const r6 = b.members.find((m: any) => m.name === S.m.m6), r1 = b.members.find((m: any) => m.name === S.m.m1);
    await chk(async () => { await expect([r6.budget, r6.custom]).toEqual([75, true]); });
    await chk(async () => { await expect([r1.budget, r1.custom]).toEqual([200, false]); });
    await page.reload();
    await expect(page.locator('#def-budget')).toHaveValue('200');
    await expect(page.locator('#rw')).not.toBeChecked();
    await expect(page.locator('#rm')).toBeChecked();
    await expect(page.getByLabel(`Budget for ${S.m.m6}`)).toHaveValue('75');
    await expect(page.getByText(fin)).toBeVisible();
    await shot(page, info, 'flow-budgets');
    await noConsoleErrors(g, 'budgets');
  });

  test('settings: org, password change with code, devices, backup email, refresh, CSV, delete data', async ({}, info) => {
    await nav(page, info, 'Settings and billing', '/settings');
    // organization
    const newName = 'QA3 Renamed ' + rand();
    await expect(page.locator('#org-name')).not.toHaveValue(''); // org loads after first paint and overwrites anything typed earlier (ADM finding)
    await page.locator('#org-name').fill(newName);
    await page.locator('#org-tz').selectOption('Asia/Kolkata');
    await page.getByRole('button', { name: 'Save organization' }).click();
    await expect(page.locator(".toast")).toHaveText('Organization saved');
    const org = (await api('GET', '/admin/org', undefined, S.token)).data;
    expect([org.name, org.timezone]).toEqual([newName, 'Asia/Kolkata']);
    await chk(async () => { await expect(page.locator('.topbar nav[aria-label="Breadcrumb"]'), 'breadcrumb shows the new org name without reload').toContainText(newName, { timeout: 2000 }); });
    await expect(page.locator('#billing')).toContainText('No invoices yet.');
    // password change (an extra API session must be revoked)
    const extra = (await api('POST', '/auth/login', { email: S.admin.email, password: PW1, client: 'web', deviceName: 'QA extra session' })).data.token;
    await page.reload();
    await expect(page.getByText('QA extra session')).toBeVisible();
    await page.getByRole('button', { name: 'Change password' }).click();
    const pd = page.getByRole('dialog', { name: 'Change your password' });
    await pd.locator('#pw-cur').fill(PW1); await pd.locator('#pw-new').fill(PW2); await pd.locator('#pw-new2').fill(PW2);
    await shot(page, info, 'flow-password-modal');
    const code = await withCode(S.admin.email, 'otp:change_password', () => pd.getByRole('button', { name: 'Continue' }).click());
    const pd2 = page.getByRole('dialog', { name: 'Enter the code from your email' });
    await fillOtp(page, code, pd2);
    await pd2.getByRole('button', { name: 'Verify and change password' }).click();
    await expect(page.locator(".toast")).toHaveText('Password changed. Other devices were signed out.');
    expect((await api('GET', '/me', undefined, extra)).status, 'other session revoked').toBe(401);
    expect((await api('POST', '/auth/login', { email: S.admin.email, password: PW1, client: 'web' })).status).toBe(401);
    await page.waitForTimeout(500);
    notes.devicesAfterPwChange = await page.locator('#security').getByText('QA extra session').count();
    await chk(async () => { await expect(notes.devicesAfterPwChange, 'signed-out device disappears from Signed-in devices after password change').toBe(0); });
    // devices sign-out
    const second = (await api('POST', '/auth/login', { email: S.admin.email, password: PW2, client: 'web', deviceName: 'QA second browser' })).data.token;
    await page.reload();
    const devRow = page.locator('#security .between', { hasText: 'QA second browser' });
    await devRow.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator(".toast")).toHaveText('Device signed out');
    await expect(page.locator('#security').getByText('QA second browser')).toHaveCount(0);
    expect((await api('GET', '/me', undefined, second)).status).toBe(401);
    await expect(page.locator('#security .between', { hasText: 'This device' })).toHaveCount(1);
    // backup email add / verify / remove
    const backup = qaEmail('backup');
    await page.locator('#bk-email').fill(backup);
    const bcode = await withCode(backup, 'otp:verify_backup', () => page.getByRole('button', { name: 'Send verification code' }).click());
    await fillOtp(page, bcode, page.locator('#security'));
    await page.getByRole('button', { name: 'Verify backup email' }).click();
    await expect(page.locator(".toast")).toHaveText('Backup email verified');
    await expect(page.locator('#security')).toContainText(backup);
    await expect(page.locator('#security')).toContainText('Verified');
    await shot(page, info, 'flow-settings-backup');
    await page.locator('#security').getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator(".toast")).toHaveText('Backup email removed');
    await expect(page.locator('#bk-email')).toBeVisible();
    // Refresh now
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.locator(".toast")).toHaveText(/^Refreshed 42 events in \d+ ms \(just now\)$/);
    // CSV export
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#data').getByRole('button', { name: 'Export CSV' }).click()]);
    const file = path.join(__dirname, 'test-results-admin', 'export-' + rand() + '.csv');
    await dl.saveAs(file);
    const csv = fs.readFileSync(file, 'utf8').trim().split('\n');
    notes.csvFilename = dl.suggestedFilename();
    notes.csv = csv;
    expect(csv[0]).toBe('day,email,name,tool,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cost_usd');
    const orgId = psql(`SELECT org_id FROM users WHERE email = '${S.admin.email}'`);
    expect(csv.length - 1, 'CSV rows = daily_usage rows').toBe(Number(psql(`SELECT count(*) FROM daily_usage d JOIN users u ON u.id = d.user_id WHERE u.org_id = '${orgId}'`)));
    const csvSum = csv.slice(1).reduce((a, l) => a + parseFloat(l.split(',').pop()!), 0);
    await chk(async () => { await expect(csvSum).toBeCloseTo(usdR(expected(S.ev.m1).costMicros) + usdR(expected(S.ev.m2).costMicros), 1); });
    await shot(page, info, 'flow-settings');
    // delete all data with code
    const dcode = await withCode(S.admin.email, 'otp:delete_data', () => page.getByRole('button', { name: 'Delete data' }).click());
    const dd = page.getByRole('alertdialog', { name: 'Confirm deleting all usage data' });
    await expect(dd.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    await fillOtp(page, dcode, dd);
    await shot(page, info, 'flow-delete-modal');
    await dd.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.locator(".toast")).toHaveText('All usage data deleted');
    expect(Number(psql(`SELECT count(*) FROM usage_events e JOIN users u ON u.id = e.user_id WHERE u.org_id = '${orgId}'`))).toBe(0);
    expect(Number(psql(`SELECT count(*) FROM daily_usage d JOIN users u ON u.id = d.user_id WHERE u.org_id = '${orgId}'`))).toBe(0);
    await nav(page, info, 'Team overview', '/');
    const { mismatches, d } = await checkOverviewAgainstApi(page, S.token);
    await chk(async () => { await expect(mismatches).toEqual([]); });
    expect(d.kpis.spend).toBe(0);
    await shot(page, info, 'flow-overview-after-delete');
    await noConsoleErrors(g, 'settings');
  });

  test('support ticket', async ({}, info) => {
    await nav(page, info, 'Support', '/support');
    await expect(page.getByText('No requests yet')).toBeVisible();
    await page.getByRole('radio', { name: /Request a feature/ }).click();
    await page.locator('#sp-title').fill('QA3 feature ' + rand());
    await page.locator('#sp-body').fill('Please add a weekly goal.');
    await page.getByRole('button', { name: 'Send feature request' }).click();
    await expect(page.locator(".toast")).toHaveText(/^Request #\d+ sent\. We’ll reply by email\.$/);
    await page.getByRole('radio', { name: /Report a bug/ }).click();
    await page.locator('#sp-title').fill('QA3 bug');
    await page.locator('#sp-body').fill('Numbers look off.');
    await page.locator('#sp-sev').selectOption('Minor annoyance');
    await page.locator('#sp-when').fill('Today');
    await page.getByRole('button', { name: 'Send bug report' }).click();
    await toastText(page);
    const list = page.locator('section.card', { hasText: 'Your requests' });
    await expect(list).toContainText('QA3 bug');
    await expect(list).toContainText('· feature');
    expect(psql(`SELECT severity || '|' || started || '|' || (diagnostics IS NOT NULL) FROM tickets t JOIN users u ON u.id = t.user_id WHERE u.email = '${S.admin.email}' AND t.kind = 'bug'`)).toBe('Minor annoyance|Today|true');
    await shot(page, info, 'flow-support');
    await noConsoleErrors(g, 'support');
  });

  test('sign out, forgot password, reset, sign in again', async ({}, info) => {
    const before = await token(page);
    { await page.locator('.topbar .user-btn').click(); await page.getByRole('menuitem', { name: 'Sign out' }).click(); } // D13 avatar menu
    await expect(page.getByRole('heading', { name: 'Sign in to the admin console' })).toBeVisible();
    expect(await token(page)).toBeNull();
    expect((await api('GET', '/me', undefined, before)).status, 'token revoked on sign out').toBe(401);
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.locator('#fp-email').fill(S.admin.email);
    const code = await withCode(S.admin.email, 'reset', () => page.getByRole('button', { name: 'Email me a code' }).click());
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await fillOtp(page, code);
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await page.locator('#np-pw').fill(PW3);
    await page.locator('#np-pw2').fill(PW3 + 'x');
    await expect(page.getByText('The passwords don’t match.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save new password' })).toBeDisabled();
    await page.locator('#np-pw2').fill(PW3);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByText('Password updated. Sign in with your new password.')).toBeVisible();
    await shot(page, info, 'flow-signin-after-reset');
    await expect(page.locator('#si-email')).toHaveValue(S.admin.email);
    await page.locator('#si-pw').fill(PW3);
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await expect(page.locator('h1')).toHaveText('Team overview');
    expect((await api('POST', '/auth/login', { email: S.admin.email, password: PW2, client: 'web' })).status).toBe(401);
    await page.waitForTimeout(1200);
    await chk(async () => { await expect(await page.locator('.tour-card').count(), 'tour not replayed on the same browser').toBe(0); });
    await noConsoleErrors(g, 'sign out / reset / sign in');
  });
  test('findings recorded in this suite', async ({}, info) => {
    test.skip(!process.env.FULL_ALL && info.project.name !== 'admin-light-1440');
    for (const f of FINDINGS) console.log('FINDING ' + f);
    const mine = FINDINGS.filter((f) => f.startsWith(`[${info.project.name}]`) && f.includes('full flow >'));
    expect(mine, 'product findings in this suite').toEqual([]);
  });

});

// =====================================================================================================================
// 2. PAGES PASS – every theme × viewport
// =====================================================================================================================
test.describe('pages pass', () => {
  test.describe.configure({ mode: 'serial' });
  let ctx: BrowserContext, page: Page, g: Guard;
  const S: any = { email: qaEmail('pages'), company: 'QA3 Pages ' + rand() };
  const notes: Record<string, unknown> = {};

  test.beforeAll(async ({ browser }, info) => { ({ ctx, page, g } = await newPage(browser, info, meta(info).theme)); });
  test.afterAll(async ({}, info) => { writeNotes(info, notes); await ctx?.close(); });

  test('auth screens + sign up', async ({}, info) => {
    const { theme } = meta(info);
    await page.goto('/app/');
    await expect(page.getByRole('heading', { name: 'Sign in to the admin console' })).toBeVisible();
    await themeOk(page, theme); await layoutOk(page, 'signin'); await shot(page, info, 'signin');
    await page.getByRole('button', { name: 'Use your invite code' }).click();
    await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
    await layoutOk(page, 'accept'); await shot(page, info, 'accept');
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await layoutOk(page, 'forgot'); await shot(page, info, 'forgot');
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await page.getByRole('tab', { name: 'Create workspace' }).click();
    await page.locator('#su-name').fill('Pat Pages');
    await page.locator('#su-email').fill(S.email);
    await page.locator('#su-co').fill(S.company);
    await page.locator('#su-pw').fill(PW1);
    await layoutOk(page, 'signup'); await shot(page, info, 'signup');
    const code = await withCode(S.email, 'otp:verify_signup', async () => {
      await page.getByRole('button', { name: 'Create workspace', exact: true }).last().click();
      await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    });
    await layoutOk(page, 'verify'); await shot(page, info, 'verify');
    await fillOtp(page, code);
    await page.getByRole('button', { name: 'Verify and open my workspace' }).click();
    await expect(page.locator('h1')).toHaveText('Team overview');
    S.token = await token(page);
    await noConsoleErrors(g, 'auth screens');
  });

  test('tour targets in this theme/viewport', async ({}, info) => {
    await tourCheck(page, info, '');
    await noConsoleErrors(g, 'tour');
  });

  test('every page, empty org', async ({}, info) => {
    const { theme } = meta(info);
    if (!isWide(info)) {
      // responsive upgrade (D1): below 1024 the sidebar is a drawer opened from the menu button
      const navVisible = (await page.getByRole('button', { name: 'Members', exact: true }).isVisible()) || (await page.getByRole('button', { name: 'Open menu' }).isVisible());
      notes.mobileNavVisible = navVisible;
      await chk(async () => { await expect(navVisible, 'a way to reach Members/Budgets/Support/Settings exists at this width').toBe(true); });
    }
    const { mismatches } = await checkOverviewAgainstApi(page, S.token);
    await chk(async () => { await expect(mismatches).toEqual([]); });
    await themeOk(page, theme); await layoutOk(page, 'overview-empty'); await shot(page, info, 'overview-empty');
    await nav(page, info, 'Members', '/members');
    await expect(page.getByText('(you)')).toBeVisible();
    await layoutOk(page, 'members-empty'); await shot(page, info, 'members-empty');
    S.selfId = await memberId(S.token, S.email);
    await page.evaluate((id) => { window.location.hash = '/members/' + id; }, S.selfId);
    await expect(page.locator('h1')).toHaveText('Member detail');
    await chk(async () => { await expect(page.getByText('No usage this month')).toBeVisible(); });
    await chk(async () => { await expect(page.getByText('No devices', { exact: true })).toBeVisible(); });
    notes.selfRecentSessionsEmptyState = await page.locator('section.card', { hasText: 'Recent sessions' }).innerText();
    await layoutOk(page, 'member-empty'); await shot(page, info, 'member-empty');
    await nav(page, info, 'Budgets and alerts', '/budgets');
    await expect(page.getByText('No alerts yet')).toBeVisible();
    await layoutOk(page, 'budgets-empty'); await shot(page, info, 'budgets-empty');
    await nav(page, info, 'Support', '/support');
    await expect(page.getByText('No requests yet')).toBeVisible();
    await layoutOk(page, 'support-empty'); await shot(page, info, 'support-empty');
    await nav(page, info, 'Settings and billing', '/settings');
    await expect(page.getByText('No invoices yet.')).toBeVisible();
    await layoutOk(page, 'settings'); await shot(page, info, 'settings');
    await noConsoleErrors(g, 'empty pages');
  });

  test('every page with data + modals; overview numbers vs API', async ({}, info) => {
    await api('POST', '/admin/billing/seats', { seats: 5, plan: 'team' }, S.token);
    const e1 = qaEmail('pm1'), e2 = qaEmail('pm2');
    const t1 = await apiMember(S.token, e1, 2500), t2 = await apiMember(S.token, e2);
    const ev1 = [...session('claude_code', 'claude-opus-4-1', 32, 110, 70, { input: 1000, output: 15000, cacheWrite: 1000, cacheRead: 40000 }),
      ...session('codex', 'gpt-5-codex', 4, 90, 15, { input: 8000, output: 4000, cacheWrite: 0, cacheRead: 10000 })];
    const ev2 = session('claude_code', 'claude-sonnet-4-5', 6, 200, 40, { input: 3000, output: 6000, cacheWrite: 500, cacheRead: 20000 });
    await ingest(t1, ev1); await ingest(t2, ev2);
    await api('POST', '/admin/members/invite', { emails: [qaEmail('pm3')], role: 'member' }, S.token);
    await api('POST', '/support/tickets', { kind: 'question', title: 'QA3 question', body: 'How?' }, S.token);
    await nav(page, info, 'Team overview', '/');
    await page.locator('[data-tour="sync"]').click();
    await toastText(page);
    await expect(page.getByText('Spend by model')).toBeVisible();
    const { mismatches, d } = await checkOverviewAgainstApi(page, S.token);
    await chk(async () => { await expect(mismatches, 'overview UI vs API').toEqual([]); });
    await chk(async () => { await expect(d.kpis.spend).toBeCloseTo(usdR(expected(ev1).costMicros) + usdR(expected(ev2).costMicros), 1); });
    await layoutOk(page, 'overview'); await shot(page, info, 'overview');
    await page.getByRole('button', { name: 'Invite members' }).first().click(); // overview toolbar → Members page
    await expect(page.locator('h1')).toHaveText('Members');
    await page.getByRole('button', { name: 'Invite members' }).click();
    await expect(page.getByRole('dialog', { name: 'Invite members' })).toBeVisible();
    await layoutOk(page, 'invite-modal'); await shot(page, info, 'invite-modal');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await layoutOk(page, 'members'); await shot(page, info, 'members');
    await page.locator('tbody tr', { hasText: e1 }).getByRole('button', { name: 'Edit budget' }).click();
    await layoutOk(page, 'budget-modal'); await shot(page, info, 'budget-modal');
    await page.keyboard.press('Escape');
    await page.locator('tbody tr', { hasText: e2 }).getByRole('button', { name: 'Remove' }).click();
    await layoutOk(page, 'remove-modal'); await shot(page, info, 'remove-modal');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    const id1 = await memberId(S.token, e1);
    await page.evaluate((id) => { window.location.hash = '/members/' + id; }, id1);
    await expect(page.getByText('QA laptop · macOS 15')).toBeVisible();
    const md = (await api('GET', `/admin/members/${id1}/usage`, undefined, S.token)).data;
    await chk(async () => { await expect((await kpi(page, 'Spend')).value).toBe(usd(md.kpis.spend)); });
    await layoutOk(page, 'member'); await shot(page, info, 'member');
    await nav(page, info, 'Budgets and alerts', '/budgets');
    await chk(async () => { await expect(page.locator('section.card', { hasText: 'Alert log' })).toContainText('reached 100%'); });
    await layoutOk(page, 'budgets'); await shot(page, info, 'budgets');
    await nav(page, info, 'Support', '/support');
    await expect(page.getByText('QA3 question')).toBeVisible();
    await layoutOk(page, 'support'); await shot(page, info, 'support');
    await nav(page, info, 'Settings and billing', '/settings');
    await page.getByRole('button', { name: 'Change plan or seats' }).click();
    await layoutOk(page, 'plan-modal'); await shot(page, info, 'plan-modal');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Change password' }).click();
    await layoutOk(page, 'password-modal'); await shot(page, info, 'password-modal');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Delete data' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await layoutOk(page, 'delete-modal'); await shot(page, info, 'delete-modal');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await layoutOk(page, 'settings-data'); await shot(page, info, 'settings-data');
    await noConsoleErrors(g, 'pages with data');
  });

  test('sign out → forgot → reset screens → sign in', async ({}, info) => {
    if (isWide(info)) { await page.locator('.topbar .user-btn').click(); await page.getByRole('menuitem', { name: 'Sign out' }).click(); } // D13 avatar menu
    else {
      const signOut = page.locator('.topbar .user-btn'); // D13 avatar menu
      notes.mobileSignOutVisible = await signOut.isVisible();
      await signOut.click(); await page.getByRole('menuitem', { name: 'Sign out' }).click();
    }
    await expect(page.getByRole('heading', { name: 'Sign in to the admin console' })).toBeVisible();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.locator('#fp-email').fill(S.email);
    const code = await withCode(S.email, 'reset', () => page.getByRole('button', { name: 'Email me a code' }).click());
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await layoutOk(page, 'reset-code'); await shot(page, info, 'reset-code');
    await fillOtp(page, code);
    await page.getByRole('button', { name: 'Verify code' }).click();
    await page.locator('#np-pw').fill(PW3); await page.locator('#np-pw2').fill(PW3);
    await layoutOk(page, 'reset-newpw'); await shot(page, info, 'reset-newpw');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await page.locator('#si-pw').fill(PW3);
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await expect(page.locator('h1')).toHaveText('Team overview');
    await noConsoleErrors(g, 'reset');
  });
  test('findings recorded in this suite', async ({}, info) => {
    test.skip(false);
    const mine = FINDINGS.filter((f) => f.startsWith(`[${info.project.name}]`) && f.includes('pages pass >'));
    expect(mine, 'product findings in this suite').toEqual([]);
  });

});
