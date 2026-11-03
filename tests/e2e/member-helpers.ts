// Helpers for the member (desktop window) e2e test: server API, dev-mode codes from the live server log,
// an isolated agent process (sandbox from tests/fixtures/member/agent-env.sh), fixture appends, registry checks.
import { execFileSync, execSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '..', '..');
export const SERVER = 'http://localhost:8080';
export const AGENT = 'http://127.0.0.1:47811';
export const WINDOW = 'http://localhost:5174';
export const SANDBOX = path.join(ROOT, 'tests', '.sandbox', 'member');
export const DATA = path.join(SANDBOX, 'data');
export const HOME = path.join(SANDBOX, 'home');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'member', 'home');
export const SERVER_LOG = path.join(ROOT, 'tests', '.server.log');
export const MARKER = 'SECRET_PROMPT_MARKER';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const rand = () => Math.random().toString(36).slice(2, 8);

export async function api(method: string, p: string, body?: unknown, token?: string): Promise<{ status: number; data: any }> {
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

// ---------- server log (DEV_MODE prints codes); the lead streams it to tests/.server.log ----------
export function serverLog(): string {
  try { return fs.readFileSync(SERVER_LOG, 'utf8'); } catch { /* fall back */ }
  return execSync('docker compose logs server --since 3h --no-color', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
}
const esc = (s: string) => s.replace(/[.+*?^$()[\]{}|\\]/g, (c) => '\\' + c);
function codeRe(email: string, kind: string) {
  const e = esc(email);
  return kind === 'invite' ? new RegExp(`invite code for ${e}: ([A-Z0-9-]{8,9})`, 'g') :
    kind === 'reset' ? new RegExp(`reset code for ${e}: (\\d{6})`, 'g') :
    new RegExp(`one-time code for ${e} \\(${kind}\\): (\\d{6})`, 'g');
}
export function countCodes(email: string, kind: string): number { return [...serverLog().matchAll(codeRe(email, kind))].length; }
/** Waits for a code newer than the first `skip` matches. kind: invite | reset | <otp purpose> */
export async function codeFor(email: string, kind: string, skip = 0): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const m = [...serverLog().matchAll(codeRe(email, kind))];
    if (m.length > skip) return m[m.length - 1][1];
    await sleep(500);
  }
  throw new Error(`no ${kind} code for ${email} in server log`);
}

export function psql(sql: string): string {
  return execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'aknologia', '-At', '-F', '|', '-c', sql], { cwd: ROOT, encoding: 'utf8' }).trim();
}

export async function createAdminOrg(tag: string) {
  const email = `qa4-${tag}@example.test`;
  const password = 'Adm1n!pass-' + tag + '-zz';
  const r = await api('POST', '/auth/signup', { name: 'Quinn Admin', email, company: `QA4 Member Co ${tag}`, teamSize: '1-10', password });
  if (r.status !== 200) throw new Error('signup ' + JSON.stringify(r.data));
  const code = await codeFor(email, 'verify_signup');
  const v = await api('POST', '/auth/verify-email', { email, code, client: 'web' });
  if (v.status !== 200) throw new Error('verify ' + JSON.stringify(v.data));
  return { email, password, token: v.data.token as string };
}

// ---------- agent ----------
export type AgentProc = { proc: ChildProcess; token: string; exe: string };
export const EXE = path.join(ROOT, 'tests', 'bin', 'aknologia-agent.exe');

export function agentEnv() {
  return {
    ...process.env,
    AKN_DATA_DIR: DATA, HOME, USERPROFILE: HOME, APPDATA: path.join(HOME, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(HOME, 'AppData', 'Local'),
    CLAUDE_CONFIG_DIR: path.join(HOME, '.claude'), CODEX_HOME: path.join(HOME, '.codex'), AKN_LISTEN: '127.0.0.1:47811',
  };
}

export function freshSandbox() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, 'AppData', 'Roaming'), { recursive: true });
  fs.mkdirSync(path.join(HOME, 'AppData', 'Local'), { recursive: true });
  fs.cpSync(FIXTURES, HOME, { recursive: true });
}

export async function startAgent(): Promise<AgentProc> {
  const proc = spawn(EXE, ['-server', SERVER], { env: agentEnv(), stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const token = fs.readFileSync(path.join(DATA, 'agent.token'), 'utf8').trim();
      const r = await fetch(AGENT + '/v1/status', { headers: { 'X-Agent-Token': token } });
      if (r.ok) return { proc, token, exe: EXE };
    } catch { /* not up yet */ }
  }
  proc.kill();
  throw new Error('agent did not start');
}

export async function stopAgent(a?: AgentProc) {
  if (!a) return;
  a.proc.kill();
  for (let i = 0; i < 20; i++) {
    try { await fetch(AGENT + '/v1/status'); await sleep(250); } catch { return; }
  }
}

export async function agentCall(a: AgentProc, p: string, method = 'GET', body?: unknown) {
  const r = await fetch(AGENT + '/v1' + p, { method, headers: { 'X-Agent-Token': a.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}

export function eventLines(): number {
  try { return fs.readFileSync(path.join(DATA, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
}

/** Appends one Claude Code assistant turn (with a prompt marker) to the "today" billing-service session. */
export function appendClaudeTurn(msgId: string, model: string, usage: { in: number; out: number; cw: number; cr: number }) {
  const sid = 'c0ffee01-0000-4000-8000-000000000003';
  const p = path.join(HOME, '.claude', 'projects', 'C--work-billing-service', sid + '.jsonl');
  const ts = new Date(Date.now() - 60_000).toISOString();
  const lines = [
    { type: 'user', sessionId: sid, cwd: 'C:\\work\\billing-service', timestamp: ts, uuid: msgId + '-u', message: { role: 'user', content: `${MARKER} appended prompt` } },
    { type: 'assistant', sessionId: sid, cwd: 'C:\\work\\billing-service', timestamp: ts, uuid: msgId + '-a', requestId: 'req_' + msgId,
      message: { id: msgId, model, role: 'assistant', content: [{ type: 'text', text: `${MARKER} appended reply` }], usage: { input_tokens: usage.in, output_tokens: usage.out, cache_creation_input_tokens: usage.cw, cache_read_input_tokens: usage.cr } } },
  ];
  fs.appendFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

export function grepDir(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (fs.readFileSync(p, 'utf8').includes(needle)) hits.push(p);
    }
  };
  walk(dir);
  return hits;
}

/** Independent oracle: totals straight from the fixture files (dedup like the parser), for events at/after `from`. */
export function fixtureTotals(from: Date) {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : p.endsWith('.jsonl') && files.push(p); } };
  walk(path.join(HOME, '.claude')); walk(path.join(HOME, '.codex'));
  const seen = new Set<string>();
  const ev: { tool: string; sid: string; ts: number; tokens: number }[] = [];
  for (const f of files) {
    let sid = '', lastTotal = -1;
    for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      const j = JSON.parse(line);
      if (j.type === 'assistant' && j.message?.usage && j.message.model !== '<synthetic>') {
        const k = j.sessionId + j.message.id + j.requestId;
        if (seen.has(k)) continue; seen.add(k);
        const u = j.message.usage;
        ev.push({ tool: 'claude_code', sid: j.sessionId, ts: Date.parse(j.timestamp), tokens: u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) });
      } else if (j.type === 'session_meta') sid = j.payload.id;
      else if (j.type === 'event_msg' && j.payload?.type === 'token_count' && j.payload.info) {
        if (j.payload.info.total_token_usage.total_tokens === lastTotal) continue;
        lastTotal = j.payload.info.total_token_usage.total_tokens;
        const l = j.payload.info.last_token_usage;
        ev.push({ tool: 'codex', sid, ts: Date.parse(j.timestamp), tokens: (l.input_tokens - l.cached_input_tokens) + l.cached_input_tokens + l.output_tokens });
      }
    }
  }
  const cur = ev.filter((e) => e.ts >= from.getTime());
  const bySess = new Map<string, number[]>();
  for (const e of cur) { const k = e.tool + e.sid; bySess.set(k, [...(bySess.get(k) ?? []), e.ts]); }
  let activeSec = 0;
  for (const ts of bySess.values()) { ts.sort((a, b) => a - b); ts.forEach((t, i) => { activeSec += i > 0 && t - ts[i - 1] <= 300_000 ? (t - ts[i - 1]) / 1000 : 30; }); }
  return { events: cur.length, tokens: cur.reduce((a, e) => a + e.tokens, 0), sessions: bySess.size, activeSec };
}

// ---------- Windows autostart (HKCU Run) ----------
export function runKey(): string | null {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name AknologiaUsage -ErrorAction Stop).AknologiaUsage"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch { return null; }
}
export function restoreRunKey(before: string | null) {
  if (before === null) {
    try { execFileSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'AknologiaUsage', '/f'], { stdio: 'ignore' }); } catch { /* absent */ }
  } else {
    execFileSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'AknologiaUsage', '/t', 'REG_SZ', '/d', before, '/f'], { stdio: 'ignore' });
  }
}
