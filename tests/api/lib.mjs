// Helpers for the API/security QA suite. Node 20+, no dependencies.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASE = process.env.BASE || 'http://localhost:8080';
export const API = BASE + '/api/v1';
export const LOGFILE = process.env.LOGFILE || path.join(ROOT, 'tests', '.server.log');

export const bodies = [];   // every response body collected (for secret-leak grep)
export const secrets = [];  // every plaintext password / token / code we used (for DB grep)

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rnd = () => randomBytes(4).toString('hex');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const mail = (tag) => `qa1-${tag}-${rnd()}@example.test`;
export const PW = () => { const p = `Granite-Harbor-${Math.floor(Math.random() * 90 + 10)}!x`; secrets.push(p); return p; };

export async function call(method, p, { token, body, headers = {}, base = API, raw, auth } = {}) {
  const h = { ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  if (auth !== undefined) h.authorization = auth;
  let payload;
  if (raw !== undefined) { payload = raw; h['content-type'] = 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await fetch(base + p, { method, headers: h, body: payload });
  const text = await res.text();
  bodies.push({ method, p, status: res.status, text });
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  if (json && typeof json.token === 'string') secrets.push(json.token);
  return { status: res.status, body: json, text, headers: res.headers };
}
export const get = (p, o) => call('GET', p, o);
export const post = (p, body, o = {}) => call('POST', p, { ...o, body });
export const put = (p, body, o = {}) => call('PUT', p, { ...o, body });
export const patch = (p, body, o = {}) => call('PATCH', p, { ...o, body });
export const del = (p, o) => call('DELETE', p, o);

// ---------- database ----------
// DB_CONTAINER set -> `docker exec <c> psql`, else the shared compose service "db".
export function psqlArgs() {
  return process.env.DB_CONTAINER ? ['exec', '-i', process.env.DB_CONTAINER] : ['compose', 'exec', '-T', 'db'];
}
export function sql(q) {
  const out = execFileSync('docker', [...psqlArgs(), 'psql', '-U', 'postgres', '-d', 'aknologia', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', q],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 });
  return out.split('\n').filter((l) => l !== '').map((l) => l.split('|'));
}
export const sql1 = (q) => (sql(q)[0] || [])[0];
export const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
export function pgDump() {
  return execFileSync('docker', [...psqlArgs(), 'pg_dump', '-U', 'postgres', '-a', 'aknologia'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
}

// ---------- server log ----------
export function serverLog() { return readFileSync(LOGFILE, 'utf8'); }
export async function fromLog(re, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const m = [...serverLog().matchAll(new RegExp(re, 'g'))];
    if (m.length) { const v = m[m.length - 1][1]; secrets.push(v); return v; }
    await sleep(250);
  }
  throw new Error('not found in server log: ' + re);
}
export const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const otpFor = (email, purpose) => fromLog(`one-time code for ${esc(email)} \\(${purpose}\\): (\\d{6})`);
export const resetFor = (email) => fromLog(`reset code for ${esc(email)}: (\\d{6})`);
export const inviteFor = (email) => fromLog(`invite code for ${esc(email)}: ([A-Z0-9]{4}-[A-Z0-9]{4})`);
export const countLog = (re) => [...serverLog().matchAll(new RegExp(re, 'g'))].length;

// ---------- tiny test runner ----------
export const results = [];
let current;
export function check(cond, msg, evidence) {
  current.checks++;
  if (!cond) current.fails.push(msg + (evidence !== undefined ? ' | evidence: ' + short(evidence) : ''));
  return !!cond;
}
export function short(v) { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 500 ? s.slice(0, 500) + '…' : s; }
export function eq(a, b, msg) { return check(a === b, `${msg}: expected ${short(b)}, got ${short(a)}`); }
export function status(r, code, msg) { return check(r.status === code, `${msg}: expected HTTP ${code}, got ${r.status}`, r.text); }
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
export async function test(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  current = { name, checks: 0, fails: [] };
  const t0 = Date.now();
  try { await fn(); } catch (e) { current.fails.push('EXCEPTION ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' / ')); }
  results.push(current);
  const ok = current.fails.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${current.checks} checks, ${Date.now() - t0} ms)${ok ? '' : '\n      - ' + current.fails.join('\n      - ')}`);
}

// ---------- domain helpers ----------
export async function newOrg(tag, { tz, seats = 10, plan = 'team' } = {}) {
  const email = mail(tag), password = PW(), name = 'Admin ' + tag;
  const s = await post('/auth/signup', { name, email, company: 'Org ' + tag + ' ' + rnd(), teamSize: '1 – 10', password });
  if (s.status !== 200) throw new Error('signup failed ' + s.text);
  const code = await otpFor(email, 'verify_signup');
  const v = await post('/auth/verify-email', { email, code, client: 'web' });
  if (v.status !== 200) throw new Error('verify failed ' + v.text);
  const org = { email, password, name, token: v.body.token, userId: v.body.user.id, orgId: v.body.org.id };
  if (seats > 3) {
    const r = await post('/admin/billing/seats', { seats, plan }, { token: org.token });
    if (r.status !== 200) throw new Error('seats failed ' + r.text);
  }
  if (tz) {
    const r = await put('/admin/org', { timezone: tz }, { token: org.token });
    if (r.status !== 200) throw new Error('tz failed ' + r.text);
  }
  return org;
}

export async function addMember(org, tag, { budgetCents, role = 'member', client = 'desktop' } = {}) {
  const email = mail(tag), password = PW();
  const body = { emails: [email], role };
  if (budgetCents !== undefined) body.budgetCents = budgetCents;
  const r = await post('/admin/members/invite', body, { token: org.token });
  if (r.status !== 200 || r.body.results[0].result !== 'invited') throw new Error('invite failed ' + r.text);
  const code = await inviteFor(email);
  const a = await post('/auth/invite/accept', { email, code, password, client, deviceName: 'dev-' + tag, os: 'Windows', appVersion: '1.0.0' });
  if (a.status !== 200) throw new Error('accept failed ' + a.text);
  return { email, password, token: a.body.token, userId: a.body.user.id, deviceId: a.body.deviceId };
}

export function ev(o = {}) {
  return {
    tool: o.tool || 'claude_code', sessionId: o.session || 's-' + rnd(), messageId: o.msg || 'm-' + rnd(), requestId: o.req ?? ('r-' + rnd()),
    model: o.model ?? 'claude-opus-4-1', // list price $15 / $75 per MTok, so 10000 output tokens = $0.75
    input: o.input ?? 0, output: o.output ?? 0, cacheWrite: o.cw ?? 0, cacheRead: o.cr ?? 0,
    ts: (o.ts instanceof Date ? o.ts : new Date(o.ts ?? Date.now() - 60000)).toISOString(), projectHash: o.project ?? '7f3a2c9d11223344', parserVersion: 'claude-1',
    ...(o.extra || {}),
  };
}
export const ingest = (token, events, extra = {}) => post('/ingest/batch', { appVersion: '1.0.0', unreadLines: 0, events, ...extra }, { token });

// Independent cost model from GET /admin/pricing ({version, models: [...]}): exact model ID after normalizing,
// no fallback (an unknown model costs nothing and is reported as unpriced). Returns micro-dollars.
export const normModel = (m) => String(m || '').toLowerCase().trim().replace(/\[1m\]$/, '').replace(/^(?:[a-z]{2,6}\.)?anthropic\.|^openai\/|^anthropic\//, '')
  .replace(/-v\d+(?::\d+)?$/, '').replace(/(?:@|-)\d{8}$/, '');
export function priceFor(pricing, model) {
  const rows = (pricing.models || pricing).filter((r) => r.model === normModel(model));
  return rows.sort((a, b) => (a.from < b.from ? 1 : -1))[0] || null;
}
export function costMicros(pricing, e) {
  const r = priceFor(pricing, e.model);
  if (!r) return 0;
  return e.input * r.input + e.output * r.output + e.cacheWrite * (r.cacheWrite5m || 0) + e.cacheRead * r.cacheRead; // tokens * $/Mtok = micro-$
}
export function savingsMicros(pricing, e) {
  const r = priceFor(pricing, e.model);
  return r ? e.cacheRead * (r.input - r.cacheRead) - e.cacheWrite * ((r.cacheWrite5m || 0) - r.input) : 0;
}
export const toUsd = (micros) => Math.round(micros / 1e4) / 100;
