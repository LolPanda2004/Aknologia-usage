// Helpers for the admin console e2e test (admin.spec.ts): server API, dev-mode codes from the server log,
// independent expected-number math, console-error guard, screenshots and layout checks.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

export const ROOT = path.resolve(__dirname, '..', '..');
export const SERVER = process.env.BASE_URL ?? 'http://localhost:8080';
export const LOG = path.join(ROOT, 'tests', '.server.log');
export const SHOTS = path.join(__dirname, 'screenshots', 'admin');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const rand = () => Math.random().toString(36).slice(2, 8);
export const qaEmail = (tag: string) => `qa3-${tag}-${rand()}@example.test`;
export const PW1 = 'Blue-Kettle-8842!';
export const PW2 = 'Green-Lantern-5531?';
export const PW3 = 'Red-Harbor-7719#';
export const MEMBER_PW = 'Quiet-Forest-2210$';

export async function api(method: string, p: string, body?: unknown, token?: string): Promise<{ status: number; data: any; headers: Headers }> {
  const res = await fetch(SERVER + '/api/v1' + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, headers: res.headers };
}

// ---------- server log (DEV_MODE prints codes) ----------
function logText(): string {
  try {
    if (fs.existsSync(LOG)) return fs.readFileSync(LOG, 'utf8');
  } catch { /* fall through */ }
  return execSync('docker compose logs server --since 60m --no-color', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** kind: invite | reset | otp:<purpose> (verify_signup, change_password, verify_backup, delete_data) */
function codeRe(email: string, kind: string) {
  const e = esc(email.toLowerCase());
  if (kind === 'invite') return new RegExp(`invite code for ${e}: ([A-Z0-9-]{8,9})`, 'g');
  if (kind === 'reset') return new RegExp(`reset code for ${e}: (\\d{6})`, 'g');
  return new RegExp(`one-time code for ${e} \\(${esc(kind.replace('otp:', ''))}\\): (\\d{6})`, 'g');
}
export function codeCount(email: string, kind: string) { return [...logText().matchAll(codeRe(email, kind))].length; }
/** Runs `action`, then waits for a new code for (email, kind) in the server log and returns it. */
export async function withCode(email: string, kind: string, action: () => Promise<unknown>): Promise<string> {
  const before = codeCount(email, kind);
  await action();
  for (let i = 0; i < 60; i++) {
    const m = [...logText().matchAll(codeRe(email, kind))];
    if (m.length > before) return m[m.length - 1][1];
    await sleep(250);
  }
  throw new Error(`no new ${kind} code for ${email} in the server log`);
}

export function psql(sql: string): string {
  return execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'aknologia', '-tAc', sql], { cwd: ROOT, encoding: 'utf8' }).trim();
}

// ---------- API flows ----------
export async function apiSignup(tag: string) {
  const email = qaEmail(tag);
  const name = 'Quinn Tester';
  const company = 'QA3 ' + tag + ' ' + rand();
  const code = await withCode(email, 'otp:verify_signup', async () => {
    const r = await api('POST', '/auth/signup', { name, email, company, teamSize: '11 – 50', password: PW1 });
    if (r.status !== 200) throw new Error('signup failed ' + JSON.stringify(r.data));
  });
  const v = await api('POST', '/auth/verify-email', { email, code, client: 'web', deviceName: 'QA api' });
  if (v.status !== 200) throw new Error('verify failed ' + JSON.stringify(v.data));
  return { email, name, company, password: PW1, token: v.data.token as string };
}

/** Invites `email` (API), accepts with a desktop client and returns the member's device token. */
export async function apiMember(adminToken: string, email: string, budgetCents: number | null = null) {
  const code = await withCode(email, 'invite', async () => {
    const r = await api('POST', '/admin/members/invite', { emails: [email], role: 'member', budgetCents }, adminToken);
    if (r.status !== 200 || r.data.results?.[0]?.result !== 'invited') throw new Error('invite failed ' + JSON.stringify(r.data));
  });
  return acceptDesktop(email, code);
}
export async function acceptDesktop(email: string, code: string) {
  const r = await api('POST', '/auth/invite/accept', { email, code, password: MEMBER_PW, client: 'desktop', deviceName: 'QA laptop', os: 'macOS 15', appVersion: '1.0.0' });
  if (r.status !== 200) throw new Error('accept failed ' + JSON.stringify(r.data));
  return r.data.token as string;
}

// ---------- usage fixtures + independent expected math ----------
export type Ev = { tool: 'claude_code' | 'codex'; sessionId: string; messageId: string; requestId: string; model: string; input: number; output: number; cacheWrite: number; cacheRead: number; ts: string; projectHash: string; parserVersion: string };
export function session(tool: Ev['tool'], model: string, turns: number, gapSec: number, startMinAgo: number, tok: { input: number; output: number; cacheWrite: number; cacheRead: number }): Ev[] {
  const sid = 'qa3-' + rand();
  const t0 = Date.now() - startMinAgo * 60_000;
  return Array.from({ length: turns }, (_, i) => ({ tool, sessionId: sid, messageId: `m${i}`, requestId: `r${i}`, model, ...tok, ts: new Date(t0 + i * gapSec * 1000).toISOString(), projectHash: 'abcdef1234567890', parserVersion: 'qa3' }));
}
export async function ingest(token: string, events: Ev[]) {
  const r = await api('POST', '/ingest/batch', { appVersion: '1.0.0', unreadLines: 0, events }, token);
  if (r.status !== 200) throw new Error('ingest failed ' + JSON.stringify(r.data));
  return r.data;
}

// List prices (USD per million tokens: input, output, 5-minute cache write, cache read) from the vendors' pricing
// pages, matched by exact model ID as the server does. A model with no price (e.g. gpt-5-codex) costs nothing and
// is reported as unpriced instead of guessed.
const RATES: Record<string, [number, number, number, number]> = {
  'claude-opus-4-1': [15, 75, 18.75, 1.5], 'claude-sonnet-4-5': [3, 15, 3.75, 0.3], 'claude-haiku-4-5': [1, 5, 1.25, 0.1],
  'claude-opus-5-5': [4, 20, 5, 0.2], 'claude-sonnet-5-5': [2, 10, 2.5, 0.1], 'gpt-5.5': [5, 30, 0, 0.5],
};
const rate = (model: string) => RATES[model.toLowerCase()] ?? [0, 0, 0, 0];
export const usdR = (micros: number) => Math.round(micros / 1e4) / 100;
/** Independent expected totals for one member's events (single day, UTC). */
export function expected(events: Ev[]) {
  const groups = new Map<string, { model: string; tool: string; in: number; out: number; cw: number; cr: number }>();
  for (const e of events) {
    const k = e.tool + '|' + e.model;
    const g = groups.get(k) ?? { model: e.model, tool: e.tool, in: 0, out: 0, cw: 0, cr: 0 };
    g.in += e.input; g.out += e.output; g.cw += e.cacheWrite; g.cr += e.cacheRead;
    groups.set(k, g);
  }
  let cost = 0, saved = 0, claude = 0, inTok = 0, cr = 0, cw = 0;
  for (const g of groups.values()) {
    const [i, o, w, r] = rate(g.model);
    const c = Math.round(g.in * i + g.out * o + g.cw * w + g.cr * r);
    cost += c; saved += Math.round(g.cr * (i - r) - g.cw * (w - i)); // net of the cache-write premium
    if (g.tool !== 'codex') claude += c;
    inTok += g.in; cr += g.cr; cw += g.cw;
  }
  const bySession = new Map<string, number[]>();
  for (const e of events) bySession.set(e.tool + e.sessionId, [...(bySession.get(e.tool + e.sessionId) ?? []), Date.parse(e.ts)]);
  let active = 0;
  for (const ts of bySession.values()) {
    ts.sort((a, b) => a - b);
    ts.forEach((t, i) => { const gap = i ? (t - ts[i - 1]) / 1000 : Infinity; active += gap <= 300 ? gap : 30; });
  }
  return { costMicros: cost, savedMicros: saved, claudeMicros: claude, activeSec: active, sessions: bySession.size, in: inTok, cr, cw };
}

// ---------- formatting identical to ui/shared/format.ts (en-US) ----------
export const usd = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: v >= 1000 ? 0 : digits, maximumFractionDigits: v >= 1000 ? 0 : digits });

// ---------- browser helpers ----------
export type Guard = { errors: string[]; mute: (on: boolean) => void };
/** Collects console errors and page errors, except blocked third-party fonts. */
export function guard(page: Page): Guard {
  const g = { errors: [] as string[], muted: false };
  const ignore = (t: string, url = '') => /fonts\.(googleapis|gstatic)\.com/.test(t + ' ' + url);
  page.on('console', (m) => {
    if (m.type() !== 'error' || g.muted) return;
    const url = m.location()?.url ?? '';
    if (ignore(m.text(), url)) return;
    g.errors.push(`[console] ${m.text()} ${url}`);
  });
  page.on('pageerror', (e) => { if (!g.muted) g.errors.push(`[pageerror] ${e.message}`); });
  page.on('requestfailed', (r) => { if (!g.muted && !ignore(r.url()) && !/\.(png|ico)$/.test(r.url())) g.errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`); });
  return { errors: g.errors, mute: (on) => { g.muted = on; } };
}

export function meta(info: TestInfo) {
  const m = info.project.metadata as { theme: 'light' | 'dark'; width: number };
  return { theme: m.theme, width: m.width, tag: `${m.theme}-${m.width}` };
}

/** Full-page screenshot: screenshots/admin/<page>-<theme>-<width>.png */
export async function shot(page: Page, info: TestInfo, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(250);
  const file = path.join(SHOTS, `${name}-${meta(info).tag}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  return file;
}

/** Elements wider than the viewport (page-level horizontal scroll) — returns a short description of offenders. */
export async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= vw + 1) return [];
    const out: string[] = [`scrollWidth ${document.documentElement.scrollWidth} > ${vw}`];
    document.querySelectorAll('body *').forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0 && !(el as HTMLElement).closest('.table-wrap')) {
        const parentOver = el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1;
        if (!parentOver) out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className || ''} right=${Math.round(r.right)} "${(el.textContent || '').trim().slice(0, 40)}"`);
      }
    });
    return out.slice(0, 8);
  });
}

export async function kpi(page: Page, label: string) {
  const card = page.locator('.kpi').filter({ has: page.locator('.label', { hasText: label }) }).first();
  return { value: (await card.locator('.value').innerText()).trim(), sub: (await card.locator('.sub').innerText().catch(() => '')).trim() };
}

export async function fillOtp(page: Page, code: string, scope = page.locator('body')) {
  for (let i = 0; i < 6; i++) await scope.getByLabel(`Digit ${i + 1}`, { exact: true }).fill(code[i]);
}

export async function toastText(page: Page) {
  const t = page.locator('.toast');
  await expect(t).toBeVisible();
  return (await t.innerText()).trim();
}

export function monthKey(offset = 0) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Compares every overview KPI, the alert banner, budget health and member rows to the API response. Returns mismatches. */
export async function checkOverviewAgainstApi(page: Page, token: string): Promise<{ mismatches: string[]; d: any }> {
  const { data: d } = await api('GET', `/admin/overview?month=${monthKey(0)}`, undefined, token);
  const k = d.kpis;
  const mm: string[] = [];
  const eq = (what: string, got: string, want: string) => { if (got !== want) mm.push(`${what}: UI "${got}" vs API-derived "${want}"`); };
  await expect(page.locator('.kpi').first()).toBeVisible();
  const spend = await kpi(page, 'Team spend');
  eq('Team spend', spend.value, usd(k.spend));
  eq('Team spend sub', spend.sub, `${k.budgets ? Math.round((k.spend / k.budgets) * 100) : 0}% of ${usd(k.budgets, 0)} in budgets · projected ${usd(k.projected, 0)}`);
  const act = await kpi(page, 'Active coding time');
  eq('Active coding time', act.value, `${k.activeHours} h`);
  eq('Active coding time sub', act.sub, k.activeMembers ? `${(k.activeHours / k.activeMembers).toFixed(1)} h per active member` : 'No activity yet');
  const cph = await kpi(page, 'Cost per active hour');
  eq('Cost per active hour', cph.value, usd(k.costPerHour));
  const am = await kpi(page, 'Active members');
  eq('Active members', am.value, `${k.activeMembers} of ${k.members}`);
  eq('Active members sub', am.sub, `${k.pendingInvites} invite${k.pendingInvites === 1 ? '' : 's'} pending`);
  const sv = await kpi(page, 'Saved by caching');
  eq('Saved by caching', sv.value, usd(k.saved, 0));
  eq('Saved by caching sub', sv.sub, `${k.cacheShare}% of input from cache`);
  // budget health
  for (const [label, key] of [['Over budget', 'over'], ['80% or more', 'near'], ['Under 80%', 'under'], ['Not started', 'notStarted']] as const) {
    const row = page.locator('section.card', { hasText: 'Budget health' }).locator('.between', { hasText: label }).first();
    eq(`Budget health ${label}`, (await row.locator('.mono').innerText()).trim(), String(d.budgetHealth[key]));
  }
  // alerts banner
  if (d.alerts.over.length || d.alerts.near.length) {
    const b = await page.locator('[data-tour="alerts"]').innerText();
    if (!b.includes(`${d.alerts.over.length} over budget and ${d.alerts.near.length} close`)) mm.push(`alert banner: "${b.slice(0, 80)}"`);
  } else if (!(await page.getByText('Everyone is under 80% of their budget.').isVisible())) mm.push('missing "Everyone is under 80%" banner');
  // member rows
  const rows = page.locator('section.card', { hasText: 'Sorted by budget used' }).locator('tbody tr');
  eq('member row count', String(await rows.count()), String(d.members.length));
  for (let i = 0; i < d.members.length; i++) {
    const m = d.members[i];
    const cells = rows.nth(i).locator('td');
    eq(`row ${i} name`, (await cells.nth(0).locator('b').innerText()).trim(), m.name);
    eq(`row ${i} status`, (await cells.nth(1).innerText()).trim(), m.status);
    eq(`row ${i} active`, (await cells.nth(2).innerText()).trim(), `${m.activeHours} h`);
    eq(`row ${i} spend`, (await cells.nth(3).innerText()).trim(), usd(m.spend));
    eq(`row ${i} budget used`, (await cells.nth(4).innerText()).trim(), `${m.pct}% of ${usd(m.budget, 0)}`);
  }
  // spend by model
  if (d.models.length === 0) { if (!(await page.getByText('No usage yet', { exact: true }).isVisible())) mm.push('missing "No usage yet" empty state'); }
  else for (const m of d.models) if (!(await page.getByText(`${m.share}% · ${usd(m.cost)}`).first().isVisible())) mm.push(`model ${m.model} share "${m.share}% · ${usd(m.cost)}" not shown`);
  if (d.costPerHour.length === 0) { if (!(await page.getByText('Not enough data yet').isVisible())) mm.push('missing "Not enough data yet" empty state'); }
  if (d.dailyActive.length === 0) { if (!(await page.locator('section.card', { hasText: 'Daily active members' }).getByText('No activity yet', { exact: true }).isVisible())) mm.push('missing "No activity yet" empty state'); }
  const dh = await page.locator('section.card', { hasText: 'Data health' }).innerText();
  if (!dh.includes(`${d.dataHealth.synced2h} of ${d.dataHealth.devices} devices synced in the last 2 hours`)) mm.push('data health devices line mismatch');
  return { mismatches: mm, d };
}
