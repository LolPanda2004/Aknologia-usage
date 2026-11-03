// node genperf.mjs <homeDir> : 160k Claude + 40k Codex usage events over 30 days (plus a user line per turn).
import fs from 'node:fs';
import path from 'node:path';
const home = process.argv[2];
fs.rmSync(home, { recursive: true, force: true });
const now = Date.now();
let n = 0;
for (let s = 0; s < 400; s++) {
  const dir = path.join(home, '.claude', 'projects', 'C--perf-proj' + (s % 20));
  fs.mkdirSync(dir, { recursive: true });
  const sid = 'perf-' + s;
  const base = now - (s % 30) * 86400e3 - 3600e3;
  const out = [];
  for (let k = 0; k < 400; k++) {
    const ts = new Date(base + k * 20e3).toISOString();
    out.push(JSON.stringify({ type: 'user', sessionId: sid, timestamp: ts, message: { role: 'user', content: 'SECRET_PROMPT_MARKER_123 ' + 'p'.repeat(200) } }));
    out.push(JSON.stringify({ type: 'assistant', sessionId: sid, requestId: `r${s}_${k}`, timestamp: ts, cwd: 'C:\\perf\\proj' + (s % 20),
      message: { id: `m${s}_${k}`, model: s % 3 ? 'claude-sonnet-4-5' : 'claude-opus-4-1', content: [{ type: 'text', text: 'SECRET_REPLY_MARKER_456 ' + 'r'.repeat(300) }],
        usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 } } }));
    n++;
  }
  fs.writeFileSync(path.join(dir, sid + '.jsonl'), out.join('\n') + '\n');
}
for (let f = 0; f < 100; f++) {
  const d = new Date(now - (f % 30) * 86400e3);
  const dir = path.join(home, '.codex', 'sessions', String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const base = d.getTime() - 3600e3;
  const out = [JSON.stringify({ timestamp: new Date(base).toISOString(), type: 'session_meta', payload: { id: 'perfcx-' + f, cwd: '/perf/cx' + (f % 10), instructions: 'SECRET_PROMPT_MARKER_123' } }),
    JSON.stringify({ timestamp: new Date(base).toISOString(), type: 'turn_context', payload: { model: 'gpt-5-codex' } })];
  for (let k = 0; k < 400; k++) {
    const ts = new Date(base + k * 20e3).toISOString();
    out.push(JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: (k + 1) * 100 }, last_token_usage: { input_tokens: 80, cached_input_tokens: 50, output_tokens: 20 } } } }));
    n++;
  }
  fs.writeFileSync(path.join(dir, `rollout-perf-${f}.jsonl`), out.join('\n') + '\n');
}
console.log('events', n);
