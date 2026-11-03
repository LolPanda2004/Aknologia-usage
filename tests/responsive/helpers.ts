// Server/agent helpers for the responsive audit. Codes come from `docker compose logs server` (DEV_MODE prints them).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '..', '..');
export const SERVER = process.env.BASE_URL ?? 'http://localhost:8080';
export const WINDOW = process.env.WINDOW_URL ?? 'http://localhost:5174';
export const AGENT = 'http://127.0.0.1:47811';
export const HERE = __dirname;
export const STATE = path.join(HERE, '.state.json');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const rand = () => Math.random().toString(36).slice(2, 8);

export async function api(method: string, p: string, body?: unknown, token?: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(SERVER + '/api/v1' + p, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data: any = text;
      try { data = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, data };
    } catch (e) {
      if (attempt >= 8) throw e; // server may be restarting: wait and retry
      await sleep(10_000);
    }
  }
}

function serverLog(): string {
  try { return execSync('docker compose logs server --since 30m --no-color', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { return ''; }
}
const esc = (s: string) => s.replace(/[.+*?^$()[\]{}|\\]/g, (c) => '\\' + c);
export async function codeFor(email: string, kind: string): Promise<string> {
  const e = esc(email);
  const re = kind === 'invite' ? new RegExp(`invite code for ${e}: ([A-Z0-9-]{8,9})`, 'g') : new RegExp(`one-time code for ${e} \\(${kind}\\): (\\d{6})`, 'g');
  for (let i = 0; i < 60; i++) {
    const m = [...serverLog().matchAll(re)];
    if (m.length) return m[m.length - 1][1];
    await sleep(500);
  }
  throw new Error(`no ${kind} code for ${email} in server log`);
}

export async function createOrg(prefix: string) {
  const tag = rand();
  const email = `${prefix}-${tag}@example.test`;
  const password = 'Resp0nsive!pass-' + tag;
  const r = await api('POST', '/auth/signup', { name: 'Rhea Layout', email, company: `Responsive Co ${tag}`, teamSize: '11 – 50', password });
  if (r.status !== 200) throw new Error('signup ' + JSON.stringify(r.data));
  const code = await codeFor(email, 'verify_signup');
  const v = await api('POST', '/auth/verify-email', { email, code, client: 'web' });
  if (v.status !== 200) throw new Error('verify ' + JSON.stringify(v.data));
  return { email, password, token: v.data.token as string };
}

type State = { empty?: { email: string; password: string; token: string } };
const readState = (): State => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});

/** Seeded org with data (from tests/a11y/.seed.json, read only). Re-logs in if the token expired. */
export async function dataOrg() {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'a11y', '.seed.json'), 'utf8'));
  if ((await api('GET', '/me', undefined, s.token)).status === 200) return s;
  const l = await api('POST', '/auth/login', { email: s.email, password: s.password, client: 'web', deviceName: 'responsive audit' });
  if (l.status !== 200) throw new Error('seed login ' + JSON.stringify(l.data));
  return { ...s, token: l.data.token };
}

/** Fresh org with no members and no usage (empty states). Saved in tests/responsive/.state.json. */
export async function emptyOrg() {
  const st = readState();
  if (st.empty && (await api('GET', '/me', undefined, st.empty.token)).status === 200) return st.empty;
  const o = await createOrg('resp-empty');
  fs.writeFileSync(STATE, JSON.stringify({ ...st, empty: o }, null, 2));
  return o;
}
