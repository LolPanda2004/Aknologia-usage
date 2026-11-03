// Checks for the Blocker fixes that run.mjs doesn't cover directly.
//   BASE=http://localhost:8093 LOGFILE=tests/api/.server-8093.log DB_CONTAINER=akn-fix-db node tests/api/verify-fixes.mjs
import { test, check, eq, newOrg, addMember, ev, ingest, call, costMicros, toUsd } from './lib.mjs';

const get = (p, o) => call('GET', p, o);
const post = (p, body, o = {}) => call('POST', p, { ...o, body });

await test('MEM-04: a mixed-model session is priced per model in admin recent sessions', async () => {
  const o = await newOrg('mixed');
  const m = await addMember(o, 'mix');
  const pricing = (await get('/admin/pricing', { token: o.token })).body;
  const list = pricing;
  const session = 'mixed-' + Date.now();
  const evs = [
    ev({ session, model: 'claude-sonnet-5-5', input: 1000, output: 4000, ts: Date.now() - 240000 }),
    ev({ session, model: 'claude-sonnet-5-5', input: 1000, output: 4000, ts: Date.now() - 180000 }),
    ev({ session, model: 'claude-haiku-5-5', input: 1000, output: 1000, ts: Date.now() - 120000 }),
    ev({ session, model: 'claude-haiku-5-5', input: 1000, output: 1000, ts: Date.now() - 90000 }),
    ev({ session, model: 'claude-haiku-5-5', input: 1000, output: 1000, ts: Date.now() - 60000 }),
  ];
  eq((await ingest(m.token, evs)).body?.accepted, 5, 'accepted');
  const want = toUsd(evs.reduce((a, e) => a + costMicros(list, e), 0));
  const u = (await get(`/admin/members/${m.userId}/usage`, { token: o.token })).body;
  const row = (u.sessions || [])[0];
  check(!!row, 'session listed', JSON.stringify(u.sessions));
  eq(row?.cost, want, 'session cost equals the per-model sum');
});

await test('API-04: one member with bad data does not break Refresh for the org', async () => {
  const o = await newOrg('refresh');
  const m = await addMember(o, 'ok');
  await ingest(m.token, [ev({ output: 10000 })]);
  const r = await ingest(m.token, [ev({ input: 5e18 })]);
  eq(r.body?.rejected, 1, 'absurd token count rejected');
  const rf = await post('/admin/refresh', {}, { token: o.token });
  eq(rf.status, 200, 'refresh status');
  eq(rf.body?.failedMembers, 0, 'no member failed');
});

await test('API-03: an event 60 days old is counted right after ingest', async () => {
  const o = await newOrg('old2');
  const m = await addMember(o, 'old');
  const ts = Date.now() - 60 * 86400000;
  eq((await ingest(m.token, [ev({ ts, output: 10000 })])).body?.accepted, 1, 'accepted');
  const month = new Date(ts).toISOString().slice(0, 7);
  eq((await get(`/admin/overview?month=${month}`, { token: o.token })).body?.kpis?.spend, 0.75, 'counted without Refresh');
});

await test('pricing: a resent request can only grow; lowering its cost is refused', async () => {
  const o = await newOrg('grow');
  const m = await addMember(o, 'grow');
  const base = ev({ model: 'claude-opus-5-5', output: 1000, session: 'g', msg: 'g1', req: 'r1' });
  eq((await ingest(m.token, [base])).body?.accepted, 1, 'first version accepted');
  const spend = async () => (await get(`/admin/members/${m.userId}/usage`, { token: o.token })).body?.kpis?.spend;
  eq(await spend(), 0.02, '1000 output x $20/MTok');
  eq((await ingest(m.token, [{ ...base, output: 1 }])).body?.duplicates, 1, 'smaller output ignored');
  eq((await ingest(m.token, [{ ...base, model: 'claude-haiku-5-5' }])).body?.duplicates, 1, 'model swap ignored');
  eq(await spend(), 0.02, 'cost unchanged');
  eq((await ingest(m.token, [{ ...base, output: 5000 }])).body?.updated, 1, 'final streamed line (larger output) accepted');
  eq(await spend(), 0.1, '5000 output x $20/MTok');
  eq((await ingest(m.token, [{ ...base, output: 5000, speed: 'fast' }])).body?.updated, 1, 'speed filled in');
  eq((await ingest(m.token, [{ ...base, output: 5000, speed: '' }])).body?.duplicates, 1, 'speed cannot be removed again');
  eq(await spend(), 0.2, 'fast mode 5000 x $40/MTok');
});
