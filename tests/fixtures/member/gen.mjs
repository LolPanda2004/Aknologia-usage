// Generates Claude Code + Codex fixture session files for the member e2e test.
// Usage: node tests/fixtures/member/gen.mjs   (writes tests/fixtures/member/home/...)
// Timestamps are relative to "now" so they always fall inside the 7-day window (and one session only in 30 days).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'home');
fs.rmSync(out, { recursive: true, force: true });

const now = new Date();
const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()); // today 00:00 UTC
const at = (daysAgo, h, m = 0, s = 0) => new Date(day0 - daysAgo * 864e5 + ((h * 60 + m) * 60 + s) * 1000);
const iso = (d) => d.toISOString();
const MARK = 'SECRET_PROMPT_MARKER';

// ---------- Claude Code ----------
function claudeSession({ id, cwd, start, turns }) {
  const folder = cwd.replace(/[:\\/]/g, '-');
  const lines = [];
  lines.push({ type: 'summary', summary: `${MARK} summary of the chat`, leafUuid: 'x' });
  turns.forEach((t, i) => {
    const ts = new Date(start.getTime() + t.min * 60000);
    lines.push({ type: 'user', sessionId: id, cwd, timestamp: iso(new Date(ts.getTime() - 5000)), uuid: `${id}-u${i}`,
      message: { role: 'user', content: `${MARK} please refactor ${cwd}\\src\\secret_file_${i}.ts` } });
    const a = { type: 'assistant', sessionId: id, cwd, timestamp: iso(ts), uuid: `${id}-a${i}`, requestId: `req_${id}_${i}`,
      message: { id: `msg_${id}_${i}`, model: t.model, role: 'assistant', content: [{ type: 'text', text: `${MARK} reply with code const x = 1;` }],
        usage: { input_tokens: t.in, output_tokens: t.out, cache_creation_input_tokens: t.cw, cache_read_input_tokens: t.cr } } };
    lines.push(a);
    if (t.dup) lines.push(a); // streaming repeat: same message + request id -> must be deduplicated
    lines.push({ type: 'user', sessionId: id, cwd, timestamp: iso(ts), uuid: `${id}-tr${i}`, toolUseResult: { stdout: `${MARK} tool output` }, message: { role: 'user', content: [{ type: 'tool_result', content: `${MARK} file contents` }] } });
  });
  // synthetic line must be skipped
  lines.push({ type: 'assistant', sessionId: id, cwd, timestamp: iso(start), uuid: `${id}-syn`, message: { id: `msg_${id}_syn`, model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } });
  const p = path.join(out, '.claude', 'projects', folder, `${id}.jsonl`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

const opus = (min, extra = {}) => ({ min, model: 'claude-opus-4-1-20250805', in: 500, out: 2000, cw: 10000, cr: 50000, ...extra });
const sonnet = (min) => ({ min, model: 'claude-sonnet-4-5-20250929', in: 1200, out: 3000, cw: 8000, cr: 120000 });
const haiku = (min) => ({ min, model: 'claude-haiku-4-5-20251001', in: 2000, out: 1500, cw: 4000, cr: 30000 });

claudeSession({ id: 'c0ffee01-0000-4000-8000-000000000001', cwd: 'C:\\work\\billing-service', start: at(1, 9), turns: [opus(0), opus(2, { dup: true }), opus(4), opus(5), opus(7), opus(9)] });
claudeSession({ id: 'c0ffee01-0000-4000-8000-000000000002', cwd: 'C:\\work\\web-dashboard', start: at(3, 14), turns: [sonnet(0), sonnet(3), haiku(6), haiku(9), haiku(12)] });
claudeSession({ id: 'c0ffee01-0000-4000-8000-000000000003', cwd: 'C:\\work\\billing-service', start: at(0, 3), turns: [sonnet(0), sonnet(1), sonnet(2), sonnet(12), sonnet(13)] });
claudeSession({ id: 'c0ffee01-0000-4000-8000-000000000004', cwd: 'C:\\work\\legacy-app', start: at(14, 10), turns: [sonnet(0), sonnet(2)] }); // only in 30-day range

// ---------- Codex ----------
function codexSession({ id, cwd, model, start, turns }) {
  const lines = [];
  lines.push({ timestamp: iso(start), type: 'session_meta', payload: { id, timestamp: iso(start), cwd, originator: 'codex_cli_rs', cli_version: '0.46.0', instructions: `${MARK} AGENTS.md contents` } });
  lines.push({ timestamp: iso(start), type: 'turn_context', payload: { cwd, approval_policy: 'on-request', sandbox_policy: { mode: 'workspace-write' }, model, summary: 'auto' } });
  let tot = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
  turns.forEach((t, i) => {
    const ts = new Date(start.getTime() + t.min * 60000);
    lines.push({ timestamp: iso(new Date(ts.getTime() - 4000)), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `${MARK} fix the bug in ${cwd}` }] } });
    lines.push({ timestamp: iso(new Date(ts.getTime() - 3000)), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: null } });
    const last = { input_tokens: t.in, cached_input_tokens: t.cached, output_tokens: t.out, reasoning_output_tokens: t.reason, total_tokens: t.in + t.out };
    tot = { input_tokens: tot.input_tokens + t.in, cached_input_tokens: tot.cached_input_tokens + t.cached, output_tokens: tot.output_tokens + t.out, reasoning_output_tokens: tot.reasoning_output_tokens + t.reason, total_tokens: tot.total_tokens + t.in + t.out };
    const tc = { timestamp: iso(ts), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { ...tot }, last_token_usage: last, model_context_window: 272000 }, rate_limits: null } };
    lines.push(tc);
    lines.push({ ...tc, timestamp: iso(new Date(ts.getTime() + 1000)) }); // repeated report (same total) -> skipped
    lines.push({ timestamp: iso(ts), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `${MARK} here is the patch` }] } });
  });
  const d = start;
  const dir = path.join(out, '.codex', 'sessions', String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `rollout-${iso(start).slice(0, 19).replace(/:/g, '-')}-${id}.jsonl`);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

const cx = (min) => ({ min, in: 40000, cached: 30000, out: 6000, reason: 2000 });
codexSession({ id: 'c0dex000-0000-4000-8000-000000000001', cwd: 'C:\\work\\web-dashboard', model: 'gpt-5-codex', start: at(2, 11), turns: [cx(0), cx(4), cx(8)] });
codexSession({ id: 'c0dex000-0000-4000-8000-000000000002', cwd: 'C:\\work\\ml-pipeline', model: 'gpt-5', start: at(4, 16), turns: [cx(0), cx(1), cx(2)] });

console.log('fixtures written to', out);
