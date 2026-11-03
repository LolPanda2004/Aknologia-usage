// QA subagent 4: member experience end-to-end in the desktop window (browser build on :5174 + sandboxed agent).
//   cd tests/e2e && npx playwright test -c playwright.member.config.ts
import { test, expect, type Page, type Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT, DATA, EXE, HOME, MARKER, ROOT, SERVER, SANDBOX, api, agentCall, appendClaudeTurn, codeFor, countCodes, createAdminOrg,
  eventLines, fixtureTotals, freshSandbox, grepDir, psql, rand, restoreRunKey, runKey, sleep, startAgent, stopAgent, type AgentProc,
} from './member-helpers';

const SHOTS = path.join(__dirname, 'screenshots', 'member');
const A11Y = path.join(ROOT, 'tests', 'a11y');
const OUT = path.join(__dirname, 'test-results-member');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(A11Y, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const TAG = rand();
const MEMBER = `member-qa4-${TAG}@example.test`;
const BACKUP = `backup-qa4-${TAG}@example.test`;
const PW1 = 'Qa4!member-pass-2026';
const PW2 = 'Qa4!changed-pass-2027';
const PW3 = 'Qa4!reset-pass-2028';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

let agent: AgentProc;
let admin: { email: string; password: string; token: string };
let memberId = '';
let inviteCode = '';
let page: Page;
let regBefore: string | null = null;
let step = 'setup';
let allow4xx = false;
const consoleErrors: { step: string; text: string; url: string; allowed: boolean }[] = [];
const axeResults: any[] = [];
const layout: { page: string; theme: string; overflowPx390: number }[] = [];
const obs: Record<string, any> = {}; // observations used by the report
const shots: string[] = [];
const checks: { name: string; got: any; want: any; ok: boolean }[] = [];
function check(name: string, got: any, want: any) { checks.push({ name, got, want, ok: got === want }); }

// ---------- helpers ----------
async function setTheme(t: 'light' | 'dark') {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  if (cur === t) return;
  try { await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).first().click({ timeout: 2000 }); }
  catch { await page.evaluate((x) => { document.documentElement.dataset.theme = x; }, t); } // e.g. tour overlay covers the toggle
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(t);
}

async function shot(name: string, full = true) {
  const f = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: f, fullPage: full });
  shots.push(path.relative(ROOT, f).replace(/\\/g, '/'));
}

/** Full-page screenshots (1440 and 390 px) and axe in both themes. */
async function sweep(name: string, opts: { narrow?: boolean } = {}) {
  const before = await page.evaluate(() => document.documentElement.dataset.theme as 'light' | 'dark');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await page.waitForTimeout(350);
    await shot(`${name}-${theme}-1440`);
    const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    axeResults.push({ page: name, theme, url: page.url(), passes: r.passes.length, incomplete: r.incomplete.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })), violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: n.failureSummary })) })) });
    if (opts.narrow !== false) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(350);
      await shot(`${name}-${theme}-390`);
      layout.push({ page: name, theme, overflowPx390: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
  await setTheme(before);
}

async function typeOtp(code: string, scope = page.locator('body')) {
  await scope.getByLabel('Digit 1').click();
  await page.keyboard.type(code, { delay: 30 });
}

const kpi = (label: string) => page.locator('.kpi').filter({ has: page.locator('.label', { hasText: label }) }).locator('.value');
async function status() { return (await agentCall(agent, '/status')).data; }
async function forceSyncTopbar() {
  await page.locator('header.page-head').getByRole('button', { name: /Force sync|Syncing/ }).click();
  await expect(page.locator('header.page-head').getByRole('button', { name: 'Force sync' })).toBeEnabled({ timeout: 60_000 });
  const t = await page.locator('.toast').first().textContent({ timeout: 10_000 }).catch(() => '');
  return t ?? '';
}
async function nav(label: string) { await page.locator('nav.side').getByRole('button', { name: label }).click(); }

// ---------- setup / teardown ----------
test.describe.serial('member experience (desktop window)', () => {
  test.beforeAll(async ({ browser }) => {
    regBefore = runKey();
    if (regBefore && regBefore.toLowerCase().includes('tests\\bin')) { // left over from a crashed run: use the recorded original
      const rec = fs.readFileSync(path.join(SANDBOX, 'registry-before.txt'), 'utf8').match(/AknologiaUsage\s*:\s*(.+)/);
      regBefore = rec ? rec[1].trim() : null;
    }
    fs.writeFileSync(path.join(OUT, 'registry-before.json'), JSON.stringify({ value: regBefore }));
    freshSandbox();
    agent = await startAgent();
    admin = await createAdminOrg(TAG);
    const inv = await api('POST', '/admin/members/invite', { emails: [MEMBER] }, admin.token);
    expect(inv.status, JSON.stringify(inv.data)).toBe(200);
    inviteCode = await codeFor(MEMBER, 'invite');
    const ms = await api('GET', '/admin/members', undefined, admin.token);
    memberId = ms.data.members.find((m: any) => m.email === MEMBER).id;
    page = await (await (browser as Browser).newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'en-US' })).newPage();
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = m.location()?.url ?? '';
      const fonts = /fonts\.(googleapis|gstatic)\.com/.test(url + m.text());
      consoleErrors.push({ step, text: m.text(), url, allowed: fonts || (allow4xx && /status of 4\d\d/.test(m.text())) });
    });
    page.on('pageerror', (e) => consoleErrors.push({ step, text: 'pageerror: ' + e.message, url: '', allowed: false }));
  });

  test.afterAll(async () => {
    await stopAgent(agent);
    restoreRunKey(regBefore);
    obs.registryAfter = runKey();
    obs.registryBefore = regBefore;
    obs.registryRestored = obs.registryAfter === regBefore;
    fs.writeFileSync(path.join(OUT, 'observations.json'), JSON.stringify({ obs, consoleErrors, layout, shots }, null, 2));
    fs.writeFileSync(path.join(A11Y, 'desktop-axe.json'), JSON.stringify({ tags: AXE_TAGS, generated: new Date().toISOString(), results: axeResults }, null, 2));
    // markdown summary
    const rows: string[] = [];
    const byId = new Map<string, { impact: string; help: string; pages: Map<string, number>; sel: Set<string> }>();
    for (const r of axeResults) for (const v of r.violations) {
      const e = byId.get(v.id) ?? { impact: v.impact, help: v.help, pages: new Map(), sel: new Set() };
      e.pages.set(`${r.page}/${r.theme}`, v.nodes.length);
      v.nodes.slice(0, 4).forEach((n: any) => e.sel.add(n.target));
      byId.set(v.id, e);
    }
    rows.push('# Desktop window: axe-core results', '', `Tags: ${AXE_TAGS.join(', ')}. Pages scanned: ${axeResults.length} (page × theme), 1440 px. Raw: desktop-axe.json.`, '');
    rows.push('| Violation | Impact | Help | Pages (page/theme: nodes) | Example selectors |', '|---|---|---|---|---|');
    for (const [id, e] of byId) rows.push(`| ${id} | ${e.impact} | ${e.help} | ${[...e.pages].map(([p, n]) => `${p}: ${n}`).join('<br>')} | ${[...e.sel].slice(0, 4).map((s) => '`' + s.replace(/\|/g, '\\|') + '`').join('<br>')} |`);
    rows.push('', '## Per page', '', '| Page | Theme | Rules passed | Violations (id: nodes) | Needs review (incomplete, id: nodes) |', '|---|---|---|---|---|');
    for (const r of axeResults) rows.push(`| ${r.page} | ${r.theme} | ${r.passes} | ${r.violations.map((v: any) => `${v.id}: ${v.nodes.length}`).join(', ') || 'none'} | ${r.incomplete.map((v: any) => `${v.id}: ${v.nodes}`).join(', ') || 'none'} |`);
    fs.writeFileSync(path.join(A11Y, 'desktop-axe.md'), rows.join('\n') + '\n');
  });

  // ---------- 0. unpaired window ----------
  test('unpaired window shows the connect screen', async ({ browser }) => {
    step = 'unpaired';
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto('/');
    await expect(p.getByRole('heading', { name: 'Connecting to the agent' })).toBeVisible();
    const bad = await (await ctx.newPage());
    await bad.goto('/?token=wrong-token');
    await expect(bad.getByText(/isn’t paired with the agent/)).toBeVisible();
    await bad.screenshot({ path: path.join(SHOTS, 'unpaired-bad-token-light-1440.png'), fullPage: true });
    shots.push('tests/e2e/screenshots/member/unpaired-bad-token-light-1440.png');
    await ctx.close();
  });

  // ---------- 1. I have an invite ----------
  test('invite: wrong code, mismatched email, password rules, success', async () => {
    step = 'invite';
    await page.goto(`/?token=${agent.token}`);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await sweep('signin-first-run');
    await page.getByRole('tab', { name: 'I have an invite' }).click();
    await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
    await sweep('invite');

    const submit = page.getByRole('button', { name: /Create password and sign in|Setting up/ });
    // password rules (client)
    await page.getByLabel('Work email').fill(MEMBER);
    await page.getByLabel('Invite code').fill(inviteCode);
    await page.getByLabel('New password', { exact: true }).fill('short1!');
    await page.getByLabel('Confirm password').fill('short1!');
    await expect(submit).toBeDisabled();
    const local = MEMBER.split('@')[0];
    await page.getByLabel('New password', { exact: true }).fill(`X1!${local}`);
    await page.getByLabel('Confirm password').fill(`X1!${local}`);
    await expect(submit).toBeDisabled(); // contains the email name
    await page.getByLabel('New password', { exact: true }).fill('NoDigitsHere!!!!');
    await expect(submit).toBeDisabled();
    await page.getByLabel('New password', { exact: true }).fill('nosymbol1234567');
    await expect(submit).toBeDisabled();
    await page.getByLabel('New password', { exact: true }).fill(PW1);
    await page.getByLabel('Confirm password').fill(PW1 + 'x');
    await expect(page.getByText('The passwords don’t match.')).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.getByLabel('Confirm password').fill(PW1);
    await expect(submit).toBeEnabled();
    await shot('invite-rules-met-light-1440');

    allow4xx = true;
    // wrong code
    await page.getByLabel('Invite code').fill('ZZZZ-ZZZZ');
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('doesn’t match this email');
    await shot('invite-wrong-code-light-1440');
    // mismatched email (right code)
    await page.getByLabel('Invite code').fill(inviteCode);
    await page.getByLabel('Work email').fill(`someone-else-${TAG}@example.test`);
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('doesn’t match this email');
    // invite code with lowercase/no dash still accepted? (input upper-cases)
    obs.inviteCodeFormat = inviteCode;
    allow4xx = false;

    // success
    await page.getByLabel('Work email').fill(MEMBER);
    await submit.click();
    await expect(page.locator('h1')).toContainText(/Good (morning|afternoon|evening)/, { timeout: 20_000 });
    const st = await status();
    expect(st.signedIn).toBe(true);
    expect(st.email).toBe(MEMBER);
    obs.afterInviteStatus = { queued: st.queued, org: st.org, role: st.role };
    // reusing the invite code again must fail
    const again = await api('POST', '/auth/invite/accept', { email: MEMBER, code: inviteCode, password: PW1, client: 'desktop' });
    obs.inviteReuse = again.status;
    expect(again.status).toBe(400);
  });

  // ---------- 2. first-run tour ----------
  test('first-run tour', async () => {
    step = 'tour';
    const tour = page.getByRole('dialog', { name: 'Product tour' });
    await expect(tour).toBeVisible({ timeout: 10_000 });
    await expect(tour).toContainText('STEP 1 OF 5');
    await expect(tour).toContainText('Your week at a glance');
    await page.waitForTimeout(500);
    await sweep('tour-step1', { narrow: true });
    const titles: string[] = [];
    for (let i = 0; i < 5; i++) {
      titles.push((await tour.locator('span').nth(1).textContent()) ?? '');
      await tour.getByRole('button', { name: i === 4 ? 'Done' : 'Next' }).click();
    }
    expect(titles).toEqual(['Your week at a glance', 'Your budget', 'Force sync', 'Help and theme', 'Support and settings']);
    await expect(tour).toBeHidden();
    // budget step: is the target there? (no budget card when the org has no default budget)
    obs.budgetCardOnTour = await page.locator('[data-tour="budget"]').count();
    // replay from "?"
    await page.getByRole('button', { name: 'Start the tour' }).click();
    await expect(tour).toBeVisible();
    await tour.getByRole('button', { name: 'Skip' }).click();
    await expect(tour).toBeHidden();
    // does not reappear on reload
    await page.reload();
    await expect(page.locator('h1')).toContainText('Good');
    await page.waitForTimeout(1500);
    await expect(tour).toBeHidden();
  });

  // ---------- 3. overview ----------
  test('overview: ranges, numbers, heatmap, projects, insights, admin match', async ({ browser }) => {
    step = 'overview';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = (d: number) => new Date(today.getTime() - (d - 1) * 864e5);
    const oracle = { d1: fixtureTotals(from(1)), d7: fixtureTotals(from(7)), d30: fixtureTotals(from(30)) };
    obs.oracle = oracle;
    const sums: any = {};
    for (const [label, d] of [['Today', '1'], ['30 days', '30'], ['7 days', '7']] as const) {
      await page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: label }).click();
      await expect(page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
      const s = (await agentCall(agent, `/summary?days=${d}`)).data;
      await expect(kpi('Sessions')).toHaveText(String(s.sessions));
      sums[d] = { ui: { active: await kpi('Active coding time').textContent(), spend: await kpi('Spend').textContent(), tokens: await kpi('Tokens').textContent(), sessions: await kpi('Sessions').textContent() },
        agent: { activeHours: s.activeHours, cost: s.cost, tokens: s.tokens, sessions: s.sessions, cacheShare: s.cacheShare, saved: s.saved } };
    }
    obs.windowSummaries = sums;
    check('Today sessions vs fixtures', sums['1'].agent.sessions, oracle.d1.sessions);
    check('7d sessions vs fixtures', sums['7'].agent.sessions, oracle.d7.sessions);
    check('30d sessions vs fixtures', sums['30'].agent.sessions, oracle.d30.sessions);
    check('7d tokens vs fixtures', sums['7'].agent.tokens, oracle.d7.tokens);
    check('30d tokens vs fixtures', sums['30'].agent.tokens, oracle.d30.tokens);
    obs.activeOracle7h = Math.round(oracle.d7.activeSec / 360) / 10;
    check('7d active hours vs fixtures (sum of seconds)', sums['7'].agent.activeHours, obs.activeOracle7h);

    await expect(page.getByRole('group', { name: 'Active time by weekday and two-hour block' })).toBeVisible();
    obs.heatCells = await page.locator('.heat .c').count();
    await expect(page.locator('section.card', { hasText: 'Top projects' })).toContainText('billing-service');
    await expect(page.getByText('SAVED BY CACHING')).toBeVisible();
    await expect(page.getByText('PRICIEST SESSION')).toBeVisible();
    await expect(page.getByText('BUSIEST DAY')).toBeVisible();
    obs.recentRows = await page.locator('section.card', { hasText: 'Recent sessions' }).locator('tbody tr').count();
    obs.budgetBefore = (await status()).budget;
    await sweep('overview');
    await page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: '30 days' }).click();
    await shot('overview-30days-light-1440');
    await page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: '7 days' }).click();

    // before sync, admin sees nothing
    const pre = await api('GET', `/admin/members/${memberId}/usage`, undefined, admin.token);
    obs.adminBeforeSync = pre.data.kpis;
    // Force sync from the top bar
    const toast = await forceSyncTopbar();
    obs.forceSyncToast = toast;
    expect(toast).toMatch(/Synced\. 0 events waiting/);
    const st = await status();
    expect(st.queued).toBe(0);
    // number match: window (7 days = all fixture events in October) vs admin month view
    const adm = await api('GET', `/admin/members/${memberId}/usage`, undefined, admin.token);
    const dbTok = psql(`SELECT sum(input_tokens+output_tokens+cache_write_tokens+cache_read_tokens), count(*), count(DISTINCT tool||session_id) FROM usage_events WHERE user_id='${memberId}'`);
    const dbMonth = psql(`SELECT sum(input_tokens+output_tokens+cache_write_tokens+cache_read_tokens), count(*) FROM usage_events WHERE user_id='${memberId}' AND ts >= date_trunc('month', now())`);
    const s7 = (await agentCall(agent, '/summary?days=7')).data;
    const s30 = (await agentCall(agent, '/summary?days=30')).data;
    const sess = (await agentCall(agent, '/sessions?days=30')).data;
    obs.numberMatch = {
      window7: { ui: sums['7'].ui, activeHours: s7.activeHours, cost: s7.cost, tokens: s7.tokens, sessions: s7.sessions, cacheShare: s7.cacheShare },
      window30: { activeHours: s30.activeHours, cost: s30.cost, tokens: s30.tokens, sessions: s30.sessions },
      adminMonth: adm.data.kpis, adminBudget: adm.data.budget, adminSessions: adm.data.sessions, dbAll: dbTok, dbMonth,
      windowSessions: sess.map((x: any) => ({ project: x.project, tool: x.tool, start: x.start, active: x.activeMinutes, tokens: x.tokens, cost: x.cost, model: x.model })),
    };
    check('spend window(7d) vs admin(month)', adm.data.kpis.spend, s7.cost);
    check('sessions window vs admin', adm.data.kpis.sessions, s7.sessions);
    check('active hours window vs admin', adm.data.kpis.activeHours, s7.activeHours);
    check('tokens window vs admin DB', Number(dbMonth.split('|')[0]), s7.tokens);
    check('cache share window vs admin', adm.data.kpis.cacheShare, s7.cacheShare);

    // admin console (member detail) screenshot + KPI text
    const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await actx.addInitScript((t) => localStorage.setItem('akn-admin-token', t), admin.token);
    const ap = await actx.newPage();
    await ap.goto(`${SERVER}/app/#/members/${memberId}`);
    await expect(ap.locator('.kpi').first()).toBeVisible({ timeout: 20_000 });
    await ap.waitForTimeout(800);
    obs.adminConsoleKpis = await ap.locator('.kpi').evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\n+/g, ' | ')));
    await ap.screenshot({ path: path.join(SHOTS, 'admin-console-member-detail.png'), fullPage: true });
    shots.push('tests/e2e/screenshots/member/admin-console-member-detail.png');
    await actx.close();
  });

  // ---------- 4. budget reached ----------
  test('budget card and budget-reached banner', async () => {
    step = 'budget';
    const r = await api('PATCH', `/admin/members/${memberId}`, { budgetCents: 100 }, admin.token);
    expect(r.status).toBe(200);
    // the window only learns the budget at the next config refresh (sync)
    await page.waitForTimeout(500);
    obs.budgetVisibleBeforeSync = await page.getByText(/You’ve reached the/).count();
    await forceSyncTopbar();
    await expect(page.getByRole('alert').filter({ hasText: 'You’ve reached the $1 monthly budget' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'Monthly budget' })).toContainText('Budget reached. Your admin has been emailed.');
    obs.budgetAfter = (await status()).budget;
    obs.budgetAlertsAfterBannerNoNewEvents = psql(`SELECT count(*) FROM budget_alerts WHERE user_id='${memberId}'`);
    await sweep('overview-budget-reached');
    // a new event makes the server evaluate budgets
    appendClaudeTurn('msg_budget_1', 'claude-sonnet-4-5-20250929', { in: 100, out: 100, cw: 0, cr: 0 });
    await forceSyncTopbar();
    obs.budgetAlertsAfterNewEvent = psql(`SELECT threshold, sent_to FROM budget_alerts WHERE user_id='${memberId}' ORDER BY threshold`);
    // "Ask for a higher budget" goes to support
    await page.getByRole('button', { name: 'Ask for a higher budget' }).click();
    await expect(page.locator('h1')).toHaveText('Support');
    await nav('Overview');
  });

  // ---------- 5. sessions ----------
  test('sessions: search, tool filter, sort, detail panel', async () => {
    step = 'sessions';
    await nav('Sessions');
    await expect(page.locator('h1')).toHaveText('Sessions');
    const list = page.getByRole('region', { name: 'Session list' });
    const rows = list.getByRole('button');
    const data = (await agentCall(agent, '/sessions?days=30')).data;
    await expect(rows).toHaveCount(data.length);
    obs.sessionCount30 = data.length;
    await sweep('sessions');
    // search
    await page.getByLabel('Search sessions').fill('billing');
    await expect(rows).toHaveCount(data.filter((s: any) => s.project.includes('billing')).length);
    await page.getByLabel('Search sessions').fill('BILLING');
    await expect(rows).toHaveCount(data.filter((s: any) => s.project.includes('billing')).length);
    await page.getByLabel('Search sessions').fill('opus'); // model names are not searchable
    obs.searchByModel = await rows.count();
    await page.getByLabel('Search sessions').fill('zz-no-such-project');
    await expect(rows).toHaveCount(0);
    obs.noResultCopy = await page.locator('main').innerText().then((t) => t.match(/No sessions[^\n]*/)?.[0]);
    await shot('sessions-no-results-light-1440');
    await page.getByLabel('Search sessions').fill('');
    // tool filter
    await page.getByLabel('Tool').selectOption('codex');
    await expect(rows).toHaveCount(data.filter((s: any) => s.tool === 'codex').length);
    await page.getByLabel('Tool').selectOption('claude_code');
    await expect(rows).toHaveCount(data.filter((s: any) => s.tool === 'claude_code').length);
    await page.getByLabel('Tool').selectOption('all');
    // sort by cost
    await page.getByLabel('Sort by').selectOption('cost');
    const costs = await rows.evaluateAll((els) => els.map((e) => Number(((e as HTMLElement).innerText.match(/\$([\d.,]+)/) ?? [])[1]?.replace(/,/g, ''))));
    expect([...costs].sort((a, b) => b - a)).toEqual(costs);
    await page.getByLabel('Sort by').selectOption('long');
    const firstLong = await rows.first().innerText();
    const longest = [...data].sort((a: any, b: any) => b.activeMinutes - a.activeMinutes)[0];
    expect(firstLong).toContain(longest.project);
    // detail panel: pick the opus billing session (has a streamed duplicate)
    await page.getByLabel('Sort by').selectOption('recent');
    const opusSess = data.find((s: any) => s.model.includes('opus'));
    const idx = data.indexOf(opusSess);
    await rows.nth(idx).click();
    await expect(rows.nth(idx)).toHaveAttribute('aria-pressed', 'true');
    const detail = page.getByRole('complementary', { name: 'Session detail' });
    await expect(detail.getByRole('heading', { level: 2 })).toHaveText(opusSess.project);
    await expect(detail).toContainText(opusSess.model);
    await expect(detail).toContainText(String(opusSess.turns));
    obs.opusTurns = opusSess.turns;
    expect(opusSess.turns, 'streamed duplicate must be counted once').toBe(6);
    const splitTokens = opusSess.split.reduce((a: number, p: any) => a + p.tokens, 0);
    expect(splitTokens).toBe(opusSess.tokens);
    obs.splitCostSum = Math.round(opusSess.split.reduce((a: number, p: any) => a + p.cost, 0) * 100) / 100;
    obs.sessionCost = opusSess.cost;
    await expect(detail).toContainText('What drove the cost');
    await shot('sessions-detail-opus-light-1440');
    // selection after filtering: does the detail follow the filtered list?
    await page.getByLabel('Tool').selectOption('codex');
    obs.detailAfterFilter = await detail.getByRole('heading', { level: 2 }).textContent();
    await page.getByLabel('Tool').selectOption('all');
    // top bar search: does it do anything?
    await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('billing');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    obs.topSearchChangedRows = (await rows.count()) !== data.length;
    await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('');
  });

  // ---------- 6. settings ----------
  test('settings: password change, backup email, devices, code on new device', async () => {
    step = 'settings-security';
    await nav('Settings and security');
    await expect(page.locator('h1')).toHaveText('Settings and security');
    await expect(page.getByText(MEMBER).first()).toBeVisible();
    await sweep('settings');

    // password change with code
    await page.getByRole('button', { name: 'Change password' }).click();
    const dlg = page.getByRole('dialog', { name: 'Change your password' });
    await expect(dlg).toBeVisible();
    await sweep('settings-password-modal', { narrow: false });
    allow4xx = true;
    await dlg.getByLabel('Current password').fill('Wrong!password-123');
    await dlg.getByLabel('New password', { exact: true }).fill(PW2);
    await dlg.getByLabel('Confirm new password').fill(PW2);
    await dlg.getByRole('button', { name: 'Continue' }).click();
    obs.pwWrongCurrent = await dlg.locator('.banner-no').textContent({ timeout: 10_000 }).catch(() => null);
    allow4xx = false;
    const n = countCodes(MEMBER, 'change_password');
    await dlg.getByLabel('Current password').fill(PW1);
    await dlg.getByRole('button', { name: 'Continue' }).click();
    const dlg2 = page.getByRole('dialog', { name: 'Enter the code from your email' });
    await expect(dlg2).toBeVisible();
    await sweep('settings-password-code', { narrow: false });
    const code = await codeFor(MEMBER, 'change_password', n);
    await typeOtp(code, dlg2);
    await dlg2.getByRole('button', { name: 'Verify and change password' }).click();
    await expect(page.locator('.toast')).toContainText('Password changed');
    expect((await api('POST', '/auth/login', { email: MEMBER, password: PW1, client: 'desktop', deviceName: 'old' })).status).toBe(401);
    // the window's own session must survive
    const me = await agentCall(agent, '/server/me');
    expect(me.status).toBe(200);

    // backup email
    await page.getByLabel('Backup email address').fill(BACKUP);
    const nb = countCodes(BACKUP, 'verify_backup');
    await page.getByRole('button', { name: 'Send verification code' }).click();
    await expect(page.getByText(/Enter the code we sent to/)).toBeVisible();
    obs.backupSentTo = await page.getByText(/Enter the code we sent to/).textContent();
    const bcode = await codeFor(BACKUP, 'verify_backup', nb);
    await typeOtp(bcode, page.locator('#security'));
    await page.getByRole('button', { name: 'Verify backup email' }).click();
    await expect(page.locator('#security')).toContainText(BACKUP);
    await expect(page.locator('#security').getByText('Verified')).toBeVisible();

    // devices: sign in a second desktop "device" through the API, then sign it out from the window
    const second = await api('POST', '/auth/login', { email: MEMBER, password: PW2, client: 'desktop', deviceName: 'QA4-LAPTOP-2', os: 'Windows', appVersion: '1.0.0' });
    expect(second.status).toBe(200);
    await nav('Overview'); await nav('Settings and security');
    const devRow = page.locator('#security .between', { hasText: 'QA4-LAPTOP-2' });
    await expect(devRow).toBeVisible();
    await expect(page.locator('#security').getByText('This device')).toBeVisible();
    await shot('settings-devices-two-light-1440', false);
    await devRow.getByRole('button', { name: 'Sign out' }).click();
    await expect(devRow).toBeHidden();
    obs.revokedDeviceMe = (await api('GET', '/me', undefined, second.data.token)).status;
    expect(obs.revokedDeviceMe).toBe(401);

    // "Ask for a code on new devices" is hidden until sign-in enforces it (QA MEM-02), so it must not be offered.
    await expect(page.getByLabel('Ask for a code on new devices')).toHaveCount(0);
    const third = await api('POST', '/auth/login', { email: MEMBER, password: PW2, client: 'desktop', deviceName: 'QA4-BRAND-NEW-PC', os: 'Windows' });
    obs.newDeviceLogin = { loginStatus: third.status, gotToken: !!third.data.token };
    if (third.data.token) await api('POST', '/auth/logout', {}, third.data.token);
  });

  test('settings: force sync, sources, pause tracking, start at login, appearance', async () => {
    step = 'settings-sync';
    const sync = page.locator('#sync');
    await expect(sync.getByText('Claude Code', { exact: true })).toBeVisible();
    obs.sources = (await status()).sources.map((s: any) => ({ tool: s.tool, found: s.found, files: s.files, unread: s.unread, eventsToday: s.eventsToday }));
    obs.sourcePills = await sync.locator('.pill').allTextContents();
    expect(obs.sources.every((s: any) => s.found)).toBe(true);
    await sync.getByRole('button', { name: 'Force sync' }).click();
    await expect(page.locator('.toast')).toContainText('Synced');

    // pause tracking
    step = 'pause';
    await page.getByLabel('Pause tracking').click();
    await expect.poll(async () => (await status()).prefs.paused).toBe(true);
    await expect(page.locator('.side-foot')).toContainText('Tracking paused');
    await shot('settings-paused-light-1440', false);
    const before = { lines: eventLines(), queued: (await status()).queued };
    appendClaudeTurn('msg_paused_1', 'claude-sonnet-4-5-20250929', { in: 777, out: 777, cw: 0, cr: 0 });
    await page.waitForTimeout(25_000); // > one 20 s scan
    await page.locator('header.page-head').getByRole('button', { name: 'Force sync' }).click();
    obs.forceSyncWhilePausedToast = await page.locator('.toast').first().textContent({ timeout: 10_000 }).catch(() => null);
    await page.waitForTimeout(1000);
    const during = { lines: eventLines(), queued: (await status()).queued };
    obs.pause = { before, during };
    expect(during.lines, 'no new event while paused').toBe(before.lines);
    const dbPaused = psql(`SELECT count(*) FROM usage_events WHERE user_id='${memberId}' AND message_id='msg_paused_1'`);
    expect(dbPaused).toBe('0');
    // resume: is the paused-period turn picked up afterwards?
    await page.getByLabel('Pause tracking').click();
    await expect.poll(async () => (await status()).prefs.paused).toBe(false);
    await forceSyncTopbar();
    obs.pause.afterResume = { lines: eventLines(), dbPausedTurn: psql(`SELECT count(*) FROM usage_events WHERE user_id='${memberId}' AND message_id='msg_paused_1'`) };

    // start at login (real HKCU Run key; restored in afterAll)
    step = 'autostart';
    const startSwitch = page.getByLabel('Start at login');
    obs.autostart = { initialChecked: await startSwitch.isChecked(), keyAtStart: runKey() };
    await startSwitch.click();
    await expect.poll(() => runKey()).toBeNull();
    await startSwitch.click();
    await expect.poll(() => runKey()).toBe(`"${EXE}"`);
    obs.autostart.keyWhenOn = runKey();
    obs.autostart.keyHasServerArgs = /-server/.test(obs.autostart.keyWhenOn ?? '');
    await startSwitch.click();
    await expect.poll(() => runKey()).toBeNull();

    // appearance
    step = 'appearance';
    const seg = page.getByRole('group', { name: 'Appearance' });
    await seg.getByRole('button', { name: 'Dark' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await expect(seg.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    await seg.getByRole('button', { name: 'Light' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    await seg.getByRole('button', { name: 'System' }).click();
    await expect(seg.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    obs.systemTheme = await page.evaluate(() => document.documentElement.dataset.theme); // colorScheme light emulated
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    obs.themeAfterReloadSystem = await page.evaluate(() => document.documentElement.dataset.theme);
    // toggle from the top bar persists
    await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
    const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    obs.themePersisted = (await page.evaluate(() => document.documentElement.dataset.theme)) === t1;
    await page.evaluate(() => localStorage.setItem('akn-theme', 'light'));
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    // settings section pills: which one is highlighted after scrolling to "Preferences"?
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Preferences' }).click();
    // D10: all section chips now share one style (none highlighted), so there may be no primary chip to read
    obs.settingsPillPrimary = (await page.getByRole('navigation', { name: 'Settings sections' }).locator('.btn-primary').count()) ? await page.getByRole('navigation', { name: 'Settings sections' }).locator('.btn-primary').textContent() : 'none (D10)';
  });

  // ---------- 7. support ----------
  test('support ticket with diagnostics', async () => {
    step = 'support';
    await nav('Support');
    await expect(page.locator('h1')).toHaveText('Support');
    await sweep('support');
    await page.getByRole('radio', { name: /Report a bug/ }).click();
    await page.getByLabel('Title').fill(`QA4 numbers look off ${TAG}`);
    await page.getByLabel('What happened, and what did you expect?').fill('Active time in the window differs from the admin console by a few minutes.');
    await page.getByLabel('How much does it affect you?').selectOption('Numbers look wrong');
    await page.getByLabel('When did it start?').fill('Today');
    await expect(page.getByLabel('Include diagnostics')).toBeChecked();
    await page.getByRole('button', { name: 'Send bug report' }).click();
    await expect(page.locator('.toast')).toContainText(/Request #\d+ sent/);
    const id = (await page.locator('.toast').textContent())!.match(/#(\d+)/)![1];
    await expect(page.locator('section.card', { hasText: 'Your requests' })).toContainText(`QA4 numbers look off ${TAG}`);
    const row = psql(`SELECT kind, severity, diagnostics::text FROM tickets WHERE id=${id}`);
    obs.ticket = { id, row: row.slice(0, 2000) };
    expect(row).toContain('appVersion');
    expect(row).not.toContain(MARKER);
    obs.ticketHasLocalPaths = /sandbox|Users\\\\|Users\//i.test(row);
    // without diagnostics
    await page.getByRole('radio', { name: /Ask a question/ }).click();
    await page.getByLabel('Title').fill(`QA4 question ${TAG}`);
    await page.getByLabel('Your question').fill('Can my admin see project names?');
    await page.getByLabel('Include diagnostics').uncheck();
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.locator('.toast')).toContainText(/Request #\d+ sent/);
    const id2 = (await page.locator('.toast').textContent())!.match(/#(\d+)/)![1];
    obs.ticketNoDiag = psql(`SELECT coalesce(diagnostics::text,'NULL') FROM tickets WHERE id=${id2}`);
    await shot('support-after-submit-light-1440');
  });

  // ---------- 8. privacy spot check ----------
  test('privacy: no prompt text leaves the sandbox fixtures', async () => {
    step = 'privacy';
    obs.markerInAgentData = grepDir(DATA, MARKER).map((p) => path.relative(ROOT, p));
    expect(obs.markerInAgentData).toEqual([]);
    obs.markerInDb = psql(`SELECT count(*) FROM usage_events WHERE user_id='${memberId}' AND (model LIKE '%SECRET%' OR session_id LIKE '%SECRET%' OR project_hash LIKE '%work%')`);
    expect(obs.markerInDb).toBe('0');
  });

  // ---------- 9. sign out, forgot password ----------
  test('sign out, wrong password, forgot password through the window', async () => {
    step = 'signout';
    await nav('Overview');
    // D13: the avatar button opens a small menu; its "Sign out" item signs out (responsive upgrade)
    await page.locator('.topbar').getByRole('button', { name: /Sign out/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect((await status()).signedIn).toBe(false);
    obs.signinEmailPrefilled = await page.getByLabel('Work email').inputValue();
    await sweep('signin');
    allow4xx = true;
    await page.getByLabel('Work email').fill(MEMBER);
    await page.getByLabel('Password', { exact: true }).fill('Wrong!password-999');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('don’t match');
    allow4xx = false;
    await page.getByRole('button', { name: /^Server:/ }).click();
    await expect(page.getByRole('dialog', { name: 'Server address' })).toBeVisible();
    await sweep('signin-server-modal', { narrow: false });
    await page.getByRole('dialog', { name: 'Server address' }).getByRole('button', { name: 'Cancel' }).click();

    step = 'forgot';
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await sweep('forgot-email');
    const n = countCodes(MEMBER, 'reset');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    obs.forgotSentTo = await page.getByText(/Enter the 6-digit code we sent to/).textContent();
    await sweep('forgot-code');
    // backup route
    const nbk = countCodes(BACKUP, 'reset');
    await page.getByRole('button', { name: 'Send to backup email instead' }).click();
    await page.waitForTimeout(1500);
    obs.forgotBackupSentTo = await page.getByText(/Enter the 6-digit code we sent to/).textContent();
    obs.backupResetLogged = countCodes(BACKUP, 'reset') > nbk;
    let code: string;
    if (obs.backupResetLogged) code = await codeFor(BACKUP, 'reset', nbk);
    else code = await codeFor(MEMBER, 'reset', n + 1);
    allow4xx = true;
    await typeOtp('000000');
    await page.getByRole('button', { name: 'Verify code' }).click();
    obs.wrongResetCode = await page.getByRole('alert').textContent({ timeout: 10_000 }).catch(() => null);
    allow4xx = false;
    for (let i = 6; i >= 1; i--) await page.getByLabel(`Digit ${i}`).fill('');
    await typeOtp(code);
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await sweep('forgot-new-password');
    await page.getByLabel('New password', { exact: true }).fill(PW3);
    await page.getByLabel('Confirm password').fill(PW3);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Password updated' })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(PW3);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('h1')).toContainText('Good', { timeout: 20_000 });
    obs.tourAfterResignin = await page.getByRole('dialog', { name: 'Product tour' }).isVisible().catch(() => false);
  });

  // ---------- 10. removed by admin ----------
  test('removed by admin: window shows the removed screen and tracking stops', async () => {
    step = 'removed';
    const del = await api('DELETE', `/admin/members/${memberId}`, undefined, admin.token);
    expect(del.status).toBe(200);
    // the window polls /status every 30 s; does it notice without a sync?
    await page.waitForTimeout(35_000);
    obs.removedShownWithoutSync = await page.getByRole('heading', { name: /You’ve been removed/ }).isVisible();
    if (!obs.removedShownWithoutSync) {
      allow4xx = true;
      await page.locator('header.page-head').getByRole('button', { name: 'Force sync' }).click();
    }
    await expect(page.getByRole('heading', { name: /You’ve been removed from/ })).toBeVisible({ timeout: 30_000 });
    allow4xx = false;
    const st = await status();
    obs.removedStatus = { signedIn: st.signedIn, removed: st.removed };
    await sweep('removed');
    const lines = eventLines();
    appendClaudeTurn('msg_after_removed', 'claude-sonnet-4-5-20250929', { in: 1, out: 1, cw: 0, cr: 0 });
    await page.waitForTimeout(22_000);
    expect(eventLines(), 'no tracking after removal').toBe(lines);
    await page.getByRole('button', { name: 'I have a new invite' }).click();
    await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
    // after a reload the removed screen should still be what the member sees
    await page.reload();
    obs.removedAfterReload = await page.getByRole('heading', { name: /You’ve been removed/ }).isVisible().catch(() => false);
    obs.removalEmail = /removed you from/.test(fs.readFileSync(path.join(ROOT, 'tests', '.server.log'), 'utf8'));
  });

  test('window numbers match fixtures and admin; no console errors', async () => {
    fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(checks, null, 2));
    fs.writeFileSync(path.join(OUT, 'console-errors.json'), JSON.stringify(consoleErrors, null, 2));
    expect.soft(checks.filter((c) => !c.ok), 'number checks').toEqual([]);
    expect.soft(consoleErrors.filter((e) => !e.allowed), 'console errors').toEqual([]);
  });
});

function serverLogCount(email: string) {
  const log = fs.readFileSync(path.join(ROOT, 'tests', '.server.log'), 'utf8');
  return (log.match(new RegExp(`one-time code for ${email.replace(/[.+]/g, (c) => '\\' + c)}`, 'g')) ?? []).length;
}
