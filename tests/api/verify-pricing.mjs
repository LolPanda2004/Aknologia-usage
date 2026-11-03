// Independent check of the pricing engine against real data (your ~/.claude and ~/.codex files):
//  1. re-prices every stored request with this file's own price table and compares it with the server's cost_micros;
//  2. re-parses the session files and checks every Claude Code request reached the server with the same tokens;
//  3. compares totals: files vs server vs admin API vs desktop window.
//   DB_CONTAINER=akn-price-db BASE=http://localhost:8094 MEMBER=<email> ADMIN_TOKEN=<token> SANDBOX=price node tests/api/verify-pricing.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const { DB_CONTAINER, BASE, MEMBER, ADMIN_TOKEN, SANDBOX = 'price' } = process.env;

// Typed in by hand from platform.claude.com/docs/en/about-claude/pricing and developers.openai.com/api/docs/pricing
// (2026-10-10), separately from catalog.json. $/MTok: input, 5m write, 1h write, cache read, output.
const A = {
  'claude-opus-5-5': [4, 5, 8, 0.2, 20], 'claude-opus-5': [5, 6.25, 10, 0.5, 25], 'claude-opus-4-8': [5, 6.25, 10, 0.5, 25],
  'claude-sonnet-5-5': [2, 2.5, 4, 0.1, 10], 'claude-sonnet-5': [2, 2.5, 4, 0.2, 10], 'claude-sonnet-4-6': [3, 3.75, 6, 0.3, 15],
  'claude-haiku-5-5': [0.1, 0.125, 0.2, 0.01, 0.5], 'claude-haiku-4-5': [1, 1.25, 2, 0.1, 5],
};
const FAST = { 'claude-opus-5-5': [8, 40], 'claude-opus-5': [10, 50], 'claude-opus-4-8': [10, 50] };
const O = { 'gpt-5.5': { std: [5, 0.5, 30], long: [10, 1, 45] }, 'gpt-5.4': { std: [2.5, 0.25, 15], long: [5, 0.5, 22.5] } };
const norm = (m) => String(m || '').toLowerCase().replace(/\[1m\]$/, '').replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '').replace(/(?:@|-)\d{8}$/, '');

function priceClaude(model, e) {
  let r = A[norm(model)];
  if (!r) return null;
  if (norm(model) === 'claude-haiku-5-5' && e.in + e.cr + e.cw > 100000) r = [0.5, 0.625, 1, 0.05, 2.5];
  if (e.speed === 'fast' && FAST[norm(model)]) { const [fi, fo] = FAST[norm(model)]; const k = fi / r[0]; r = [fi, r[1] * k, r[2] * k, r[3] * k, fo]; }
  const w1 = e.cw1h, w5 = e.cw - e.cw1h;
  let c = e.in * r[0] + w5 * r[1] + w1 * r[2] + e.cr * r[3] + e.out * r[4];
  if (e.geo === 'us') c *= 1.1;
  return c + e.web * 10000; // $10 per 1000 searches = 10000 micro-$ each
}
function priceCodex(model, e) {
  const p = O[norm(model)];
  if (!p) return null;
  const r = e.in + e.cr > 272000 ? p.long : p.std;
  return e.in * r[0] + e.cr * r[1] + e.out * r[2];
}

const sql = (q) => execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'aknologia', '-At', '-F', '\t', '-c', q], { encoding: 'utf8', maxBuffer: 1 << 28 });
const rows = sql(`SELECT e.tool, e.session_id, e.message_id, e.request_id, e.model, e.input_tokens, e.output_tokens, e.cache_write_tokens, e.cache_write_1h_tokens,
  e.cache_read_tokens, e.speed, e.inference_geo, e.web_search_requests, coalesce(e.cost_micros::text, 'NULL'), e.ts FROM usage_events e JOIN users u ON u.id = e.user_id
  WHERE u.email = '${MEMBER}'`).trim().split('\n').map((l) => l.split('\t'));

// 1. per-request re-pricing
let mism = 0, n = 0, serverTotal = 0, mineTotal = 0, unpriced = 0, maxTs = '';
const byModel = {};
const serverClaude = new Map();
for (const [tool, sid, mid, rid, model, ...f] of rows) {
  const [inp, out, cw, cw1h, cr] = f.slice(0, 5).map(Number);
  const [speed, geo, web, cost, ts] = [f[5], f[6], Number(f[7]), f[8], f[9]];
  if (ts > maxTs) maxTs = ts;
  const e = { in: inp, out, cw, cw1h, cr, speed, geo, web };
  const mine = tool === 'codex' ? priceCodex(model, e) : priceClaude(model, e);
  n++;
  if (cost === 'NULL' || mine == null) {
    if (!(cost === 'NULL' && mine == null)) { mism++; console.log('priced/unpriced disagree', model, cost, mine); }
    unpriced++;
    continue;
  }
  if (Math.abs(Number(cost) - mine) > 1) { if (mism++ < 5) console.log('MISMATCH', model, e, 'server', cost, 'mine', mine); }
  serverTotal += Number(cost); mineTotal += mine;
  (byModel[norm(model)] ||= { n: 0, server: 0 }).n++; byModel[norm(model)].server += Number(cost);
  if (tool === 'claude_code') serverClaude.set(`${sid}|${mid}|${rid}`, e);
}
console.log(`1. Re-priced ${n} stored requests independently: ${mism} mismatches (>1 micro-$), ${unpriced} unpriced.`);
console.log(`   server $${(serverTotal / 1e6).toFixed(4)}  vs  independent $${(mineTotal / 1e6).toFixed(4)}`);

// 2. capture check: re-parse Claude Code files, keep the largest-output line per request (the final streamed line)
function* jsonl(dir) {
  if (!fs.existsSync(dir)) return;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* jsonl(p); else if (p.endsWith('.jsonl')) yield p;
  }
}
const files = new Map();
const cutoff = new Date(maxTs.replace(' ', 'T').replace(/\+00$/, 'Z')).getTime();
for (const file of jsonl(path.join(os.homedir(), '.claude', 'projects'))) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const m = o.message;
    if (o.type !== 'assistant' || !m?.usage || m.model === '<synthetic>' || Date.parse(o.timestamp) > cutoff) continue;
    const u = m.usage, cc = u.cache_creation || {};
    const e = { in: u.input_tokens || 0, out: u.output_tokens || 0, cw: Math.max(u.cache_creation_input_tokens || 0, (cc.ephemeral_5m_input_tokens || 0) + (cc.ephemeral_1h_input_tokens || 0)),
      cw1h: cc.ephemeral_1h_input_tokens || 0, cr: u.cache_read_input_tokens || 0, speed: u.speed || '', geo: u.inference_geo || '', web: u.server_tool_use?.web_search_requests || 0 };
    const k = `${o.sessionId || path.basename(file, '.jsonl')}|${m.id}|${o.requestId || ''}`;
    const prev = files.get(k);
    if (!prev || e.out > prev.e.out) files.set(k, { e, model: m.model });
  }
}
let missing = 0, diff = 0, fileTotal = 0;
for (const [k, { e, model }] of files) {
  fileTotal += priceClaude(model, e) ?? 0;
  const s = serverClaude.get(k);
  if (!s) { missing++; continue; }
  if (['in', 'out', 'cw', 'cw1h', 'cr', 'web'].some((f) => s[f] !== e[f]) || s.speed !== e.speed || s.geo !== e.geo) { if (diff++ < 5) console.log('TOKENS DIFFER', k, 'file', e, 'server', s); }
}
console.log(`2. Claude Code requests in files (up to the last synced one): ${files.size}; on server: ${serverClaude.size}; missing: ${missing}; token differences: ${diff}.`);
console.log(`   files priced $${(fileTotal / 1e6).toFixed(4)}  vs  server Claude $${((serverTotal - (byModel['gpt-5.5']?.server || 0)) / 1e6).toFixed(4)}`);

// 3. totals across views
const daily = Number(sql(`SELECT coalesce(sum(cost_micros),0) FROM daily_usage d JOIN users u ON u.id = d.user_id WHERE u.email = '${MEMBER}'`).trim());
console.log(`3. daily_usage total $${(daily / 1e6).toFixed(4)} (should equal server per-request total $${(serverTotal / 1e6).toFixed(4)})`);
const H = { Authorization: 'Bearer ' + ADMIN_TOKEN };
const members = await (await fetch(`${BASE}/api/v1/admin/members`, { headers: H })).json();
const me = (members.members || members).find((m) => m.email === MEMBER);
const months = sql(`SELECT DISTINCT to_char(ts AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') FROM usage_events e JOIN users u ON u.id = e.user_id WHERE u.email = '${MEMBER}' ORDER BY 1`).trim().split('\n');
let apiTotal = 0;
for (const mo of months) {
  const o = await (await fetch(`${BASE}/api/v1/admin/overview?month=${mo}`, { headers: H })).json();
  apiTotal += o.kpis.spend;
  console.log(`   admin overview ${mo}: $${o.kpis.spend}`);
}
console.log(`   admin overview, all months: $${apiTotal.toFixed(2)}`);
const win = JSON.parse(fs.readFileSync(`tests/.sandbox/${SANDBOX}/summary-400.json`, 'utf8').replace(/^﻿/, ''));
console.log(`   desktop window (400 days): $${win.cost}`);
const u = await (await fetch(`${BASE}/api/v1/admin/members/${me.id}/usage`, { headers: H })).json();
console.log(`   admin member page this month: $${u.kpis.spend}`);
console.log('By model (server):'); for (const [m, t] of Object.entries(byModel)) console.log(`   ${m.padEnd(20)} ${String(t.n).padStart(5)}  $${(t.server / 1e6).toFixed(2)}`);
