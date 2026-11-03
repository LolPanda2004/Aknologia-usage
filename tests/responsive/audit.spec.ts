// Responsive audit: full-page screenshots + layout checks + axe for every page/state, every width, both themes.
// See playwright.responsive.config.ts for how to run. Results: results/<PHASE>/*.json, screenshots/<PHASE>/<page>-<width>-<theme>.png
import { test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { measure } from './measure';
import { AGENT, HERE, SERVER, WINDOW, api, codeFor, createOrg, dataOrg, emptyOrg, rand, sleep } from './helpers';
import { freshSandbox, restoreRunKey, runKey, startAgent, stopAgent, agentCall, type AgentProc } from '../e2e/member-helpers';

const PHASE = process.env.PHASE ?? 'before';
const WIDTHS = (process.env.WIDTHS ?? '360,390,768,1024,1280,1440,1920').split(',').map(Number);
const THEMES = (process.env.THEMES ?? 'light,dark').split(',') as ('light' | 'dark')[];
const AXE_WIDTHS = (process.env.AXE_WIDTHS ?? '390,1440').split(',').map(Number);
const GROUPS = (process.env.GROUPS ?? 'web,desktop').split(',');
const REDUCED = process.env.REDUCED_MOTION === '1';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const HEIGHT: Record<number, number> = { 320: 640, 360: 740, 390: 844, 768: 1024, 1024: 768, 1280: 800, 1440: 900, 1920: 1080 };
const SHOTS = path.join(HERE, 'screenshots', PHASE);
const RES = path.join(HERE, 'results', PHASE);
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RES, { recursive: true });

type Size = { w: number; h: number; label: string };
type Row = { group: string; page: string; width: string; theme: string; shot: string; m?: any; axe?: any[]; console: string[]; error?: string };

class Run {
  rows: Row[] = [];
  consoleErrs: string[] = [];
  constructor(public group: string, public size: Size, public theme: string) {}
  watch(page: Page) {
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text() + (m.location()?.url ?? ''))) this.consoleErrs.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => this.consoleErrs.push('pageerror: ' + e.message.slice(0, 200)));
  }
  async rec(page: Page, name: string, opts: { full?: boolean } = {}) {
    const file = `${name}-${this.size.label}-${this.theme}.png`;
    const row: Row = { group: this.group, page: name, width: this.size.label, theme: this.theme, shot: `tests/responsive/screenshots/${PHASE}/${file}`, console: [] };
    try {
      await settle(page);
      row.m = await page.evaluate(measure, { touch: this.size.w <= 768 });
      await page.screenshot({ path: path.join(SHOTS, file), fullPage: opts.full !== false, animations: 'disabled' });
      if (AXE_WIDTHS.includes(this.size.w) && this.size.label === String(this.size.w)) {
        const a = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        row.axe = a.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
      }
    } catch (e: any) { row.error = String(e.message ?? e).slice(0, 300); }
    row.console = this.consoleErrs.splice(0);
    this.rows.push(row);
  }
  save() { fs.writeFileSync(path.join(RES, `${this.group}-${this.size.label}-${this.theme}.json`), JSON.stringify(this.rows, null, 2)); }
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
  await page.waitForFunction(() => !/Loading (team|members|member|budgets|account)|Reading (your|sessions)/.test(document.body.innerText), undefined, { timeout: 10000 }).catch(() => {});
  // landing scroll reveal: scroll through once like a reader would, so revealed blocks are in their final state
  if (await page.evaluate(() => document.documentElement.classList.contains('reveal-on')).catch(() => false)) {
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight * 0.6) { window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }); await new Promise((r) => setTimeout(r, 80)); } window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); });
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(350);
}

async function newCtx(browser: Browser, size: Size, theme: string, init: Record<string, string | null>) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, colorScheme: theme as any, hasTouch: size.w <= 768, reducedMotion: REDUCED ? 'reduce' : 'no-preference' });
  await ctx.addInitScript((kv) => { try { for (const [k, v] of Object.entries(kv)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v as string); } } catch { /* about:blank */ } }, { 'akn-theme': theme, ...init });
  return ctx;
}

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
/** Rewrites a JSON response (or fakes one) without touching the server/agent. OPTIONS preflights pass through. */
async function patch(page: Page, url: string | RegExp, fn: (j: any) => any, fake = false) {
  await page.route(url, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    if (fake) return json(route, fn(null));
    const resp = await route.fetch();
    let j: any = {};
    try { j = await resp.json(); } catch { /* empty */ }
    return route.fulfill({ response: resp, json: fn(j) });
  });
}
const jsClick = (page: Page, css: string) => page.evaluate((c) => (document.querySelector(c) as HTMLElement | null)?.click(), css);
async function fresh(page: Page, url: string) { await page.goto('about:blank'); await page.goto(url); }
async function typeOtp(page: Page) { await page.locator('.otp input').first().click(); await page.keyboard.type('123456'); }
async function tour(run: Run, page: Page, prefix: string) {
  await jsClick(page, '[aria-label="Start the tour"]');
  for (let i = 1; i <= 5; i++) {
    await page.waitForTimeout(1100);
    await run.rec(page, `${prefix}tour-${i}`, { full: false });
    if (i < 5) await jsClick(page, '.tour-card .btn-primary');
  }
  await jsClick(page, '.tour-card .btn-ghost');
}

const sizes = (desktop: boolean): Size[] => [...WIDTHS.map((w) => ({ w, h: HEIGHT[w] ?? 900, label: String(w) })), ...(desktop ? [{ w: 960, h: 640, label: '960x640' }] : [])];

// ======================= web: landing, /download/, admin console =======================
if (GROUPS.includes('web')) test.describe('web', () => {
  let D: any, E: any, selfId = '';
  test.beforeAll(async () => {
    D = await dataOrg();
    E = await emptyOrg();
    selfId = (await api('GET', '/admin/members', undefined, E.token)).data.members[0].id;
  });
  for (const theme of THEMES) for (const size of sizes(false)) {
    test(`web ${size.label} ${theme}`, async ({ browser }) => {
      const run = new Run('web', size, theme);
      // --- public + auth (signed out)
      const anon = await newCtx(browser, size, theme, { 'akn-admin-token': null });
      let p = await anon.newPage(); run.watch(p);
      await p.goto(SERVER + '/'); await run.rec(p, 'landing');
      await p.goto(SERVER + '/download/'); await run.rec(p, 'download');
      await fresh(p, SERVER + '/app/#/'); await run.rec(p, 'admin-signin');
      await fresh(p, SERVER + '/app/#/signup'); await run.rec(p, 'admin-signup');
      await patch(p, '**/api/v1/auth/signup', () => ({ sentTo: 'r***@example.test' }), true);
      await p.fill('#su-name', 'Rhea Layout'); await p.fill('#su-email', 'rhea@example.test'); await p.fill('#su-co', 'Responsive Co'); await p.fill('#su-pw', 'Valid!passw0rd-xyz');
      await p.getByRole('button', { name: 'Create workspace', exact: true }).last().click(); await run.rec(p, 'admin-verify');
      await fresh(p, SERVER + '/app/#/accept'); await run.rec(p, 'admin-accept');
      await fresh(p, SERVER + '/app/#/'); await p.getByRole('button', { name: 'Forgot password?' }).click(); await run.rec(p, 'admin-forgot');
      await patch(p, '**/api/v1/auth/password/forgot', () => ({ sentTo: 'r***@example.test' }), true);
      await patch(p, '**/api/v1/auth/password/reset', () => ({}), true);
      await p.fill('#fp-email', 'rhea@example.test'); await p.getByRole('button', { name: 'Email me a code' }).click(); await run.rec(p, 'admin-otp');
      await typeOtp(p); await p.getByRole('button', { name: 'Verify code' }).click(); await run.rec(p, 'admin-newpw');
      await anon.close();

      // --- signed in, org with data
      const ctx = await newCtx(browser, size, theme, { 'akn-admin-token': D.token, 'akn-admin-toured': '1' });
      p = await ctx.newPage(); run.watch(p);
      const id = D.memberIds[D.members[0]];
      for (const [h, n] of [['#/', 'admin-overview'], ['#/members', 'admin-members'], [`#/members/${id}`, 'admin-member-detail'], ['#/budgets', 'admin-budgets'], ['#/support', 'admin-support'], ['#/settings', 'admin-settings']]) {
        await p.goto(SERVER + '/app/' + h); await run.rec(p, n);
      }
      // modals
      await p.goto(SERVER + '/app/#/members'); await settle(p);
      await p.getByRole('button', { name: 'Invite members' }).click(); await p.fill('#inv-emails', 'ana@example.test,'); await run.rec(p, 'modal-invite', { full: false }); await p.keyboard.press('Escape');
      await p.getByRole('button', { name: 'Remove', exact: true }).first().click(); await run.rec(p, 'modal-remove', { full: false }); await p.keyboard.press('Escape');
      await p.getByRole('button', { name: 'Edit budget' }).first().click(); await run.rec(p, 'modal-budget', { full: false }); await p.keyboard.press('Escape');
      await p.goto(SERVER + '/app/#/settings'); await settle(p);
      await p.getByRole('button', { name: 'Change plan or seats' }).click(); await run.rec(p, 'modal-plan', { full: false }); await p.keyboard.press('Escape');
      await patch(p, '**/api/v1/admin/data/delete/start', () => ({ sentTo: 'q***@example.test' }), true);
      await p.getByRole('button', { name: 'Delete data' }).click(); await run.rec(p, 'modal-delete-data', { full: false }); await p.keyboard.press('Escape');
      await patch(p, '**/api/v1/me/password/start', () => ({ sentTo: 'q***@example.test' }), true);
      await p.getByRole('button', { name: 'Change password' }).click(); await run.rec(p, 'modal-password-1', { full: false });
      await p.fill('#pw-cur', 'Old!passw0rd-xyz'); await p.fill('#pw-new', 'New!passw0rd-xyz9'); await p.fill('#pw-new2', 'New!passw0rd-xyz9');
      await p.getByRole('button', { name: 'Continue' }).click(); await run.rec(p, 'modal-password-2', { full: false }); await p.keyboard.press('Escape');
      // tour (from the help button)
      await p.goto(SERVER + '/app/#/'); await settle(p); await tour(run, p, 'admin-');
      await ctx.close();

      // --- signed in, empty org
      const ectx = await newCtx(browser, size, theme, { 'akn-admin-token': E.token, 'akn-admin-toured': '1' });
      p = await ectx.newPage(); run.watch(p);
      for (const [h, n] of [['#/', 'admin-empty-overview'], ['#/members', 'admin-empty-members'], [`#/members/${selfId}`, 'admin-empty-member-detail'], ['#/budgets', 'admin-empty-budgets'], ['#/settings', 'admin-empty-settings']]) {
        await p.goto(SERVER + '/app/' + h); await run.rec(p, n);
      }
      await ectx.close();
      run.save();
    });
  }
});

// ======================= desktop window (Vite :5174 + sandboxed agent) =======================
if (GROUPS.includes('desktop')) test.describe.serial('desktop', () => {
  let agent: AgentProc | undefined;
  let regBefore: string | null = null;
  test.beforeAll(async () => {
    regBefore = runKey();
    if (!regBefore || regBefore.toLowerCase().includes('tests\\bin')) {
      const f = path.join(HERE, 'registry-before.txt');
      if (fs.existsSync(f)) regBefore = fs.readFileSync(f, 'utf8').trim() || null;
    }
    freshSandbox();
    agent = await startAgent();
    const admin = await createOrg('resp-desk');
    await api('POST', '/admin/billing/seats', { seats: 10, plan: 'team' }, admin.token);
    await api('PUT', '/admin/budgets', { defaultBudget: 20, alert80: true, alert100: true, weeklySummary: true, emailMemberAt100: false, inboxes: [], members: {} }, admin.token);
    const member = `resp-member-${rand()}@example.test`;
    const inv = await api('POST', '/admin/members/invite', { emails: [member], role: 'member', budgetCents: null }, admin.token);
    if (inv.status !== 200) throw new Error('invite ' + JSON.stringify(inv.data));
    const code = await codeFor(member, 'invite');
    const acc = await agentCall(agent, '/auth/accept-invite', 'POST', { email: member, code, password: 'Memb3r!layout-' + rand() });
    if (acc.status !== 200) throw new Error('accept ' + JSON.stringify(acc.data));
    for (let i = 0; i < 80; i++) { const s = await agentCall(agent, '/summary?days=30'); if (s.data.sessions > 0) break; await sleep(1000); }
    await agentCall(agent, '/sync', 'POST', {});
  });
  test.afterAll(async () => {
    await stopAgent(agent);
    restoreRunKey(regBefore);
    fs.writeFileSync(path.join(HERE, 'results', PHASE, 'registry.json'), JSON.stringify({ before: regBefore, after: runKey() }, null, 2));
  });

  for (const theme of THEMES) for (const size of sizes(true)) {
    test(`desktop ${size.label} ${theme}`, async ({ browser }) => {
      const run = new Run('desktop', size, theme);
      const tok = agent!.token;
      // unpaired
      const un = await newCtx(browser, size, theme, { 'akn-agent-token': null });
      let p = await un.newPage(); run.watch(p);
      await p.goto(WINDOW + '/'); await run.rec(p, 'desk-unpaired'); await un.close();

      const ctx = await newCtx(browser, size, theme, { 'akn-agent-token': tok, 'akn-desk-toured': '1' });
      // auth screens: the agent is signed in, so fake a signed-out status
      p = await ctx.newPage(); run.watch(p);
      await patch(p, AGENT + '/v1/status', (j) => ({ ...j, signedIn: false }));
      await patch(p, AGENT + '/v1/auth/forgot', () => ({ sentTo: 'r***@example.test' }), true);
      await patch(p, AGENT + '/v1/auth/reset', () => ({}), true);
      await p.goto(`${WINDOW}/?token=${tok}`); await run.rec(p, 'desk-signin');
      await p.getByRole('button', { name: /^Server:/ }).click(); await run.rec(p, 'desk-modal-server', { full: false }); await p.keyboard.press('Escape');
      await p.getByRole('tab', { name: 'I have an invite' }).click(); await run.rec(p, 'desk-invite');
      await p.getByRole('tab', { name: 'Sign in' }).click(); await p.getByRole('button', { name: 'Forgot password?' }).click(); await run.rec(p, 'desk-forgot');
      await p.getByRole('button', { name: 'Email me a code' }).click(); await run.rec(p, 'desk-otp');
      await typeOtp(p); await p.getByRole('button', { name: 'Verify code' }).click(); await run.rec(p, 'desk-newpw');
      await p.close();
      p = await ctx.newPage(); run.watch(p);
      await patch(p, AGENT + '/v1/status', (j) => ({ ...j, signedIn: false, removed: true }));
      await p.goto(`${WINDOW}/?token=${tok}`); await run.rec(p, 'desk-removed'); await p.close();

      // signed in
      p = await ctx.newPage(); run.watch(p);
      for (const [h, n] of [['#/', 'desk-overview'], ['#/sessions', 'desk-sessions'], ['#/support', 'desk-support'], ['#/settings', 'desk-settings']]) {
        await p.goto(`${WINDOW}/?token=${tok}${h}`); await run.rec(p, n);
      }
      await patch(p, /\/v1\/server\/me\/password\/start/, () => ({ sentTo: 'r***@example.test' }), true);
      await p.getByRole('button', { name: 'Change password' }).click(); await run.rec(p, 'desk-modal-password-1', { full: false });
      await p.fill('#pw-cur', 'Old!passw0rd-xyz'); await p.fill('#pw-new', 'New!passw0rd-xyz9'); await p.fill('#pw-new2', 'New!passw0rd-xyz9');
      await p.getByRole('button', { name: 'Continue' }).click(); await run.rec(p, 'desk-modal-password-2', { full: false }); await p.keyboard.press('Escape');
      await p.goto(`${WINDOW}/?token=${tok}#/`); await settle(p); await tour(run, p, 'desk-');
      await p.close();

      // empty states + budget reached
      p = await ctx.newPage(); run.watch(p);
      await patch(p, /\/v1\/summary\?/, (j) => ({ ...j, sessions: 0, recent: [], projects: [], models: [] }));
      await patch(p, /\/v1\/sessions\?/, () => []);
      await p.goto(`${WINDOW}/?token=${tok}#/`); await run.rec(p, 'desk-empty-overview');
      await p.goto(`${WINDOW}/?token=${tok}#/sessions`); await run.rec(p, 'desk-empty-sessions');
      await p.close();
      p = await ctx.newPage(); run.watch(p);
      await patch(p, AGENT + '/v1/status', (j) => ({ ...j, budget: { ...(j.budget ?? { month: 'October', resetsOn: '2026-11-01', projectedCents: 3000 }), budgetCents: 2000, spentCents: 2440, pct: 122 } }));
      await p.goto(`${WINDOW}/?token=${tok}#/`); await run.rec(p, 'desk-overview-over-budget');
      await ctx.close();
      run.save();
    });
  }
});
