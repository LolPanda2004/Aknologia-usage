// QA subagent 5 helpers: server API, dev-mode codes from the docker server log, seeded org state.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '..', '..');
export const SERVER = process.env.BASE_URL ?? 'http://localhost:8080';
export const OUT = __dirname;
export const STATE = path.join(OUT, '.seed.json');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const rand = () => Math.random().toString(36).slice(2, 8);

export async function api(method: string, p: string, body?: unknown, token?: string) {
  const res = await fetch(SERVER + '/api/v1' + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data };
}

function serverLog(): string {
  return execSync('docker compose logs server --since 60m --no-color', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
}

export async function codeFor(email: string, kind: 'invite' | 'reset' | string, skip = 0): Promise<string> {
  const e = email.replace(/[.+]/g, (c) => '\\' + c);
  const re = kind === 'invite' ? new RegExp(`invite code for ${e}: ([A-Z0-9-]{9})`, 'g')
    : kind === 'reset' ? new RegExp(`reset code for ${e}: (\\d{6})`, 'g')
    : new RegExp(`one-time code for ${e} \\(${kind}\\): (\\d{6})`, 'g');
  for (let i = 0; i < 40; i++) {
    const m = [...serverLog().matchAll(re)];
    if (m.length > skip) return m[m.length - 1][1];
    await sleep(500);
  }
  throw new Error(`no ${kind} code for ${email} in server log`);
}

export function psql(sql: string): string {
  return execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'aknologia', '-At', '-c', sql], { cwd: ROOT, encoding: 'utf8' }).trim();
}

export type Seed = { email: string; password: string; token: string; memberIds: Record<string, string>; members: string[] };

/** Creates an admin org with 2 active members (one over budget, one near), 1 pending invite. Reused across runs via .seed.json. */
export async function seed(): Promise<Seed> {
  if (fs.existsSync(STATE)) {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8')) as Seed;
    const me = await api('GET', '/me', undefined, s.token);
    if (me.status === 200) return s;
  }
  const tag = rand();
  const email = `qa5-${tag}@example.test`;
  const password = 'Qa5!access-' + tag + '-zz9';
  let r = await api('POST', '/auth/signup', { name: 'Quinn Access', email, company: `QA5 Studio ${tag}`, teamSize: '11 – 50', password });
  if (r.status !== 200) throw new Error('signup ' + JSON.stringify(r.data));
  const code = await codeFor(email, 'verify_signup');
  r = await api('POST', '/auth/verify-email', { email, code, client: 'web' });
  if (r.status !== 200) throw new Error('verify ' + JSON.stringify(r.data));
  const token = r.data.token as string;
  // more seats so invites fit
  await api('POST', '/admin/billing/seats', { seats: 10, plan: 'team' }, token);
  await api('PUT', '/admin/budgets', { defaultBudget: 20, alert80: true, alert100: true, weeklySummary: true, emailMemberAt100: false, inboxes: [], members: {} }, token);
  const members = [`qa5m1-${tag}@example.test`, `qa5m2-${tag}@example.test`, `qa5m3-${tag}@example.test`];
  r = await api('POST', '/admin/members/invite', { emails: members, role: 'member', budgetCents: null }, token);
  if (r.status !== 200) throw new Error('invite ' + JSON.stringify(r.data));
  const names = ['Priya Raman', 'Daniel Okafor'];
  for (let i = 0; i < 2; i++) {
    const inv = await codeFor(members[i], 'invite');
    const pw = 'Memb3r!pass-' + tag + i;
    const a = await api('POST', '/auth/invite/accept', { email: members[i], code: inv, password: pw, client: 'desktop', deviceName: i ? 'Daniel-PC' : 'Priya-MBP', os: i ? 'windows' : 'darwin', appVersion: '1.0.0' });
    if (a.status !== 200) throw new Error('accept ' + JSON.stringify(a.data));
    psql(`UPDATE users SET name='${names[i]}' WHERE email='${members[i]}'`);
    const events: any[] = [];
    const now = Date.now();
    const days = new Date().getDate();
    const n = i === 0 ? 120 : 60;
    for (let k = 0; k < n; k++) {
      const ts = new Date(now - ((k * 37) % Math.max(1, days)) * 86400000 - (k % 9) * 240000 - 60000);
      events.push({
        tool: k % 3 === 0 ? 'codex' : 'claude_code', sessionId: `s-${i}-${Math.floor(k / 6)}`, messageId: `m-${i}-${k}`, requestId: `r-${i}-${k}`,
        model: k % 3 === 0 ? 'gpt-5-codex' : k % 2 ? 'claude-sonnet-4-5' : 'claude-opus-4-1',
        input: 4000 + k * 10, output: i === 0 ? 9000 : 3000, cacheWrite: 2000, cacheRead: 60000, ts: ts.toISOString(), projectHash: 'p' + (k % 4), parserVersion: '1',
      });
    }
    const ing = await api('POST', '/ingest/batch', { appVersion: i ? '0.9.0' : '1.0.0', unreadLines: i ? 3 : 0, events }, a.data.token);
    if (ing.status !== 200) throw new Error('ingest ' + JSON.stringify(ing.data));
  }
  const list = await api('GET', '/admin/members', undefined, token);
  const memberIds: Record<string, string> = {};
  for (const m of list.data.members) memberIds[m.email] = m.id;
  const s: Seed = { email, password, token, memberIds, members };
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
  return s;
}
