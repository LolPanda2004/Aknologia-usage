// Generates Claude Code + Codex session fixtures into a sandbox home.
// usage: node genfixtures.mjs <homeDir>
// Writes <homeDir>/expected.json with the numbers the agent must produce.
import fs from 'node:fs';
import path from 'node:path';

const home = process.argv[2];
if (!home) throw new Error('home dir required');
const claudeRoot = path.join(home, '.claude', 'projects');
const codexRoot = path.join(home, '.codex', 'sessions');
fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
fs.rmSync(path.join(home, '.codex'), { recursive: true, force: true });

const M1 = 'SECRET_PROMPT_MARKER_123', M2 = 'SECRET_REPLY_MARKER_456', M3 = 'SECRET_TOOL_MARKER_789';
const J = (o) => JSON.stringify(o) + '\n';
const exp = { claude: {}, codex: {} };

function asst({ sid, mid, req, model = 'claude-sonnet-4-5', ts, cwd, u, text = M2, extra = {} }) {
  return { type: 'assistant', sessionId: sid, requestId: req, uuid: 'u-' + mid, timestamp: ts, cwd,
    message: { id: mid, model, role: 'assistant', content: [{ type: 'text', text }], usage: u }, ...extra };
}

// ---------- Claude file A: edge cases, unicode folder ----------
const folderA = 'C--Users-dev-ünïcødé-项目';
const cwdA = 'C:\\Users\\dev\\ünïcødé 项目\\app';
fs.mkdirSync(path.join(claudeRoot, folderA), { recursive: true });
const sidA = 'aaaaaaaa-0000-4000-8000-000000000001';
let a = '';
a += J({ type: 'user', sessionId: sidA, timestamp: '2026-10-09T10:00:00.000Z', cwd: cwdA, message: { role: 'user', content: M1 + ' please refactor' } });
const u1 = { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000 };
a += J(asst({ sid: sidA, mid: 'msg_a1', req: 'req_a1', ts: '2026-10-09T10:00:05.000Z', cwd: cwdA, u: u1, text: 'thinking ' + M2 }));
a += J(asst({ sid: sidA, mid: 'msg_a1', req: 'req_a1', ts: '2026-10-09T10:00:05.500Z', cwd: cwdA, u: u1, text: 'tool_use ' + M3 })); // streamed duplicate
// user tool_result mentioning "usage" in text
a += J({ type: 'user', sessionId: sidA, timestamp: '2026-10-09T10:00:06.000Z', cwd: cwdA, message: { role: 'user', content: [{ type: 'tool_result', content: M3 + ' "usage": {"input_tokens": 999}' }] } });
a += J(asst({ sid: sidA, mid: 'msg_syn', req: 'req_syn', model: '<synthetic>', ts: '2026-10-09T10:00:07.000Z', cwd: cwdA, u: { input_tokens: 0, output_tokens: 0 } }));
a += J({ type: 'assistant', sessionId: sidA, timestamp: '2026-10-09T10:00:08.000Z', cwd: cwdA, message: { id: 'msg_nousage', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: M2 }] } }); // missing usage
a += J({ type: 'assistant', sessionId: sidA, cwd: cwdA, message: { id: 'msg_nots', model: 'claude-sonnet-4-5', usage: { input_tokens: 1, output_tokens: 1 } } }); // no timestamp -> unread
a += '{"type":"assistant","message":{"usage":{"input_tokens": 5, BROKEN ' + M1 + '\n'; // broken JSON w/ usage -> unread
a += '{"type":"user", broken without the u-word ' + M1 + '\n'; // broken JSON, not usage-like -> ignored
// 5 MB line
const big = M2 + ' ' + 'x'.repeat(5 * 1024 * 1024) + ' ' + M2;
a += J(asst({ sid: sidA, mid: 'msg_a2', req: 'req_a2', ts: '2026-10-09T10:01:00.000Z', cwd: cwdA, u: { input_tokens: 7, output_tokens: 77, cache_creation_input_tokens: 0, cache_read_input_tokens: 700 }, text: big }));
// streamed duplicate with DIFFERENT usage (first partial, then final)
a += J(asst({ sid: sidA, mid: 'msg_a4', req: 'req_a4', ts: '2026-10-09T10:02:00.000Z', cwd: cwdA, u: { input_tokens: 3, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
a += J(asst({ sid: sidA, mid: 'msg_a4', req: 'req_a4', ts: '2026-10-09T10:02:01.000Z', cwd: cwdA, u: { input_tokens: 3, output_tokens: 450, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
// partial last line (no newline)
const partial = JSON.stringify(asst({ sid: sidA, mid: 'msg_a3', req: 'req_a3', ts: '2026-10-09T10:03:00.000Z', cwd: cwdA, u: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 } }));
a += partial.slice(0, 80);
const fileA = path.join(claudeRoot, folderA, sidA + '.jsonl');
fs.writeFileSync(fileA, a);
fs.writeFileSync(path.join(home, 'partial-rest.txt'), partial.slice(80) + '\n');
exp.claude.fileA = { path: fileA, events: ['msg_a1 10/100/1000/5000', 'msg_a2 7/77/0/700', 'msg_a4 3/(1 or 450)'], unread: 2 };

// ---------- Claude: many sessions across days ----------
let manyIn = 0, manyOut = 0, manyCW = 0, manyCR = 0, manyN = 0;
for (let s = 0; s < 30; s++) {
  const day = 1 + (s % 10);
  const folder = 'C--Users-dev-proj' + (s % 3);
  const cwd = 'C:\\Users\\dev\\proj' + (s % 3);
  fs.mkdirSync(path.join(claudeRoot, folder), { recursive: true });
  const sid = `bbbbbbbb-0000-4000-8000-${String(s).padStart(12, '0')}`;
  let t = '';
  for (let k = 0; k < 5; k++) {
    const u = { input_tokens: 100 + s, output_tokens: 200 + k, cache_creation_input_tokens: 10 * k, cache_read_input_tokens: 1000 + s * k };
    manyIn += u.input_tokens; manyOut += u.output_tokens; manyCW += u.cache_creation_input_tokens; manyCR += u.cache_read_input_tokens; manyN++;
    const ts = new Date(Date.UTC(2026, 9, day, 9 + (s % 8), k * 3, 0)).toISOString();
    t += J({ type: 'user', sessionId: sid, timestamp: ts, cwd, message: { role: 'user', content: M1 } });
    t += J(asst({ sid, mid: `msg_${s}_${k}`, req: `req_${s}_${k}`, ts, cwd, u, model: s % 2 ? 'claude-opus-4-1' : 'claude-sonnet-4-5' }));
  }
  fs.writeFileSync(path.join(claudeRoot, folder, sid + '.jsonl'), t);
}
exp.claude.many = { events: manyN, input: manyIn, output: manyOut, cacheWrite: manyCW, cacheRead: manyCR };

// ---------- Codex: normal rollout ----------
const cdir = path.join(codexRoot, '2026', '10', '05');
fs.mkdirSync(cdir, { recursive: true });
let c = '';
c += J({ timestamp: '2026-10-05T09:00:00.000Z', type: 'session_meta', payload: { id: 'cx-qa-1', cwd: 'D:\\work\\ünï 项目', instructions: M1, cli_version: '0.50.0' } });
c += J({ timestamp: '2026-10-05T09:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5-codex', cwd: 'D:\\work\\ünï 项目' } });
c += J({ timestamp: '2026-10-05T09:00:01.500Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: M1 }] } });
c += J({ timestamp: '2026-10-05T09:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: null } });
c += J({ timestamp: '2026-10-05T09:00:09.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 1200, total_tokens: 6200 }, last_token_usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 1200, reasoning_output_tokens: 300, total_tokens: 6200 } } } });
c += J({ timestamp: '2026-10-05T09:00:10.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 6200 }, last_token_usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 1200, total_tokens: 6200 } } } });
c += J({ timestamp: '2026-10-05T09:00:20.000Z', type: 'response_item', payload: { type: 'function_call_output', output: M3 } });
c += J({ timestamp: '2026-10-05T09:00:30.000Z', type: 'event_msg', payload: { type: 'agent_message', message: M2 } });
c += J({ timestamp: '2026-10-05T09:01:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 9000 }, last_token_usage: { input_tokens: 2500, cached_input_tokens: 2000, output_tokens: 300, total_tokens: 2800 } } } });
c += '{"timestamp":"2026-10-05T09:01:05Z","type":"event_msg","payload":{"type":"token_count", BROKEN\n'; // unread
c += J({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 9100 }, last_token_usage: { input_tokens: 1, output_tokens: 1 } } } }); // no timestamp -> unread
const codexA = path.join(cdir, 'rollout-2026-10-05T09-00-00-cx-qa-1.jsonl');
fs.writeFileSync(codexA, c);
exp.codex.normal = { path: codexA, events: ['in 1000 cr 4000 out 1200', 'in 500 cr 2000 out 300'], unread: 2 };

// ---------- Codex: old format (no payload) ----------
const odir = path.join(codexRoot, '2025', '08', '01');
fs.mkdirSync(odir, { recursive: true });
let o = '';
o += J({ timestamp: '2025-08-01T08:00:00.000Z', type: 'session_meta', id: 'cx-old', cwd: '/old/proj', model: 'gpt-5', instructions: M1 });
o += J({ timestamp: '2025-08-01T08:00:05.000Z', type: 'token_count', info: { total_token_usage: { total_tokens: 300 }, last_token_usage: { input_tokens: 200, cached_input_tokens: 50, output_tokens: 100 } } });
fs.writeFileSync(path.join(odir, 'rollout-2025-08-01-old.jsonl'), o);
exp.codex.old = { events: ['in 150 cr 50 out 100 model gpt-5'] };

// ---------- Codex: no session_meta (counted unread) ----------
let n = J({ timestamp: '2026-10-06T08:00:05.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 10 }, last_token_usage: { input_tokens: 5, output_tokens: 5 } } } });
fs.mkdirSync(path.join(codexRoot, '2026', '10', '06'), { recursive: true });
fs.writeFileSync(path.join(codexRoot, '2026', '10', '06', 'rollout-nometa.jsonl'), n);
exp.codex.nometa = { events: 0, unread: 1 };

exp.totals = { events: 3 + manyN + 2 + 1, unread: 2 + 2 + 1 };
fs.writeFileSync(path.join(home, 'expected.json'), JSON.stringify(exp, null, 2));
console.log(JSON.stringify(exp.totals), JSON.stringify(exp.claude.many));
