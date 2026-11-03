// API and security QA suite for Aknologia Usage.
//   node tests/api/run.mjs                    (shared server http://localhost:8080, DEV_MODE=true, log in tests/.server.log)
//   ONLY=ingest node tests/api/run.mjs        (run a subset by test-name regex)
// Rate-limit tests live in ratelimit.mjs (needs a DEV_MODE=false server).
import {
  API, BASE, bodies, secrets, sleep, rnd, sha256, mail, PW, call, get, post, put, patch, del, sql, sql1, q, pgDump,
  serverLog, otpFor, resetFor, inviteFor, countLog, esc, results, check, eq, status, test, short,
  newOrg, addMember, ev, ingest, costMicros, savingsMicros, toUsd,
} from './lib.mjs';
import { writeFileSync } from 'node:fs';

const H = 3600e3, D = 86400e3;
const wrongCode = (c) => String((Number(c) + 1) % 1e6).padStart(6, '0');
const notifs = async (tok) => (await get('/me/notifications', { token: tok })).body || [];
const alertRows = (uid) => sql(`SELECT threshold, sent_to FROM budget_alerts WHERE user_id = ${q(uid)} ORDER BY threshold`);
const opusOut = (n, sess, tsBase = Date.now() - 2 * H) => Array.from({ length: n }, (_, i) => ev({ session: sess, output: 10000, ts: tsBase + i * 1000 })); // $0.75 each
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

console.log(`Target ${BASE}`);
if ((await get('/health')).status !== 200) { console.error('server not healthy'); process.exit(2); }

// ======================= AUTH =======================
let A; // main org used by several tests
await test('auth: signup -> verify email -> login (web admin), /me has no secrets', async () => {
  const email = mail('signup'), password = PW(), name = 'Signup Admin';
  const s = await post('/auth/signup', { name, email, company: 'QA1 Co', teamSize: '1 – 10', password });
  status(s, 200, 'signup'); eq(s.body?.status, 'verify', 'signup status');
  eq(sql1(`SELECT status FROM users WHERE email = ${q(email)}`), 'unverified', 'user is unverified before code');
  const pre = await post('/auth/login', { email, password, client: 'web' });
  eq(pre.body?.error, 'unverified', 'login before verify');
  const code = await otpFor(email, 'verify_signup');
  const v = await post('/auth/verify-email', { email, code, client: 'web' });
  status(v, 200, 'verify'); check(typeof v.body?.token === 'string' && v.body.token.length >= 40, 'token returned');
  eq(v.body?.user?.role, 'admin', 'creator is admin');
  const l = await post('/auth/login', { email, password, client: 'web' });
  status(l, 200, 'login web');
  const me = await get('/me', { token: l.body.token });
  status(me, 200, '/me'); check(!/password_?hash|code_?hash|token_?hash|"hash"/i.test(me.text), '/me exposes no password/hash fields', me.text);
  const wrong = await post('/auth/login', { email, password: password + 'x', client: 'web' });
  status(wrong, 401, 'wrong password'); eq(wrong.body?.error, 'bad_credentials', 'wrong password error');
  const unknown = await post('/auth/login', { email: mail('nobody'), password, client: 'web' });
  status(unknown, 401, 'unknown email');
  const noauth = await get('/me'); status(noauth, 401, 'no token');
  const junk = await get('/me', { token: 'not-a-real-token' }); status(junk, 401, 'junk token');
});

await test('auth: duplicate signup (same email, also upper-case) is 409', async () => {
  A = await newOrg('main', { seats: 200 });
  const r = await post('/auth/signup', { name: 'Dup', email: A.email, company: 'X', password: PW() });
  status(r, 409, 'duplicate'); eq(r.body?.error, 'exists', 'error kind');
  const r2 = await post('/auth/signup', { name: 'Dup', email: '  ' + A.email.toUpperCase() + ' ', company: 'X', password: PW() });
  status(r2, 409, 'duplicate upper-case');
  eq(sql1(`SELECT count(*) FROM users WHERE lower(email) = lower(${q(A.email)})`), '1', 'still one user row');
});

await test('auth: password rules (12+, number, symbol, not email name / name)', async () => {
  const email = mail('pw');
  const local = email.split('@')[0];
  const cases = [
    ['Ab1!xyzabcd', 'Use at least 12 characters.'],
    ['Granite-Harbor-x!', 'Add at least one number.'],
    ['GraniteHarbor12', 'Add at least one symbol.'],
    ['Zz9!' + local, 'Don’t include your email or name.'],
    ['Zz9!' + local.toUpperCase(), 'Don’t include your email or name.'],
    ['Kowalski-2026!!', 'Don’t include your email or name.'],
  ];
  for (const [pw, msg] of cases) {
    const r = await post('/auth/signup', { name: 'Kowalski', email, company: 'X', password: pw });
    status(r, 400, `weak "${pw}"`); eq(r.body?.message, msg, `message for "${pw}"`);
  }
  const ok = await post('/auth/signup', { name: 'Kowalski', email, company: 'X', password: 'Granite-Harbor-12' });
  status(ok, 200, 'a strong password is accepted');
});

await test('auth: member cannot use admin console (login web -> 403 not_admin), desktop ok', async () => {
  const m = await addMember(A, 'member');
  const w = await post('/auth/login', { email: m.email, password: m.password, client: 'web' });
  status(w, 403, 'member web login'); eq(w.body?.error, 'not_admin', 'error kind');
  const d = await post('/auth/login', { email: m.email, password: m.password, client: 'desktop' });
  status(d, 200, 'member desktop login');
  const noClient = await post('/auth/login', { email: m.email, password: m.password });
  status(noClient, 403, 'member login with no client field');
});

// ======================= ONE-TIME CODES =======================
async function signupOnly(tag) {
  const email = mail(tag), password = PW();
  const r = await post('/auth/signup', { name: 'Otp ' + tag, email, company: 'OTP ' + tag, password });
  if (r.status !== 200) throw new Error(r.text);
  return { email, password, code: await otpFor(email, 'verify_signup') };
}
await test('otp: wrong code rejected, right code still works', async () => {
  const s = await signupOnly('otpwrong');
  const w = await post('/auth/verify-email', { email: s.email, code: wrongCode(s.code), client: 'web' });
  status(w, 400, 'wrong code');
  const ok = await post('/auth/verify-email', { email: s.email, code: s.code, client: 'web' });
  status(ok, 200, 'right code after one wrong');
});
await test('otp: expired code rejected', async () => {
  const s = await signupOnly('otpexp');
  sql(`UPDATE otps SET expires_at = now() - interval '1 second' WHERE email = ${q(s.email)}`);
  const r = await post('/auth/verify-email', { email: s.email, code: s.code, client: 'web' });
  status(r, 400, 'expired code');
});
await test('otp: 5 wrong attempts burn the code', async () => {
  const s = await signupOnly('otpburn');
  for (let i = 0; i < 5; i++) await post('/auth/verify-email', { email: s.email, code: wrongCode(s.code), client: 'web' });
  eq(sql1(`SELECT attempts FROM otps WHERE email = ${q(s.email)} ORDER BY id DESC LIMIT 1`), '5', 'attempts recorded');
  const r = await post('/auth/verify-email', { email: s.email, code: s.code, client: 'web' });
  status(r, 400, 'right code after 5 wrong');
});
await test('otp: a used code cannot be reused', async () => {
  const s = await signupOnly('otpreuse');
  status(await post('/auth/verify-email', { email: s.email, code: s.code, client: 'web' }), 200, 'first use');
  status(await post('/auth/verify-email', { email: s.email, code: s.code, client: 'web' }), 400, 'second use');
});
await test('otp: parallel wrong guesses must not exceed the 5-attempt limit', async () => {
  const s = await signupOnly('otprace');
  const rs = await Promise.all(Array.from({ length: 40 }, () => post('/auth/verify-email', { email: s.email, code: wrongCode(s.code), client: 'web' })));
  const attempts = Number(sql1(`SELECT attempts FROM otps WHERE email = ${q(s.email)} ORDER BY id DESC LIMIT 1`));
  check(rs.every((r) => r.status === 400), 'all wrong guesses rejected');
  check(attempts <= 5, `at most 5 guesses should be compared against the code; attempts counter = ${attempts}`, { attempts });
});
await test('otp: reset code sent to verified backup email works; revokes old sessions', async () => {
  const m = await addMember(A, 'backup');
  const backup = mail('bk');
  status(await post('/me/backup-email', { email: backup }, { token: m.token }), 200, 'start backup');
  const bc = await otpFor(backup, 'verify_backup');
  status(await post('/me/backup-email/verify', { code: wrongCode(bc) }, { token: m.token }), 400, 'wrong backup code');
  status(await post('/me/backup-email/verify', { code: bc }, { token: m.token }), 200, 'verify backup');
  eq((await get('/me', { token: m.token })).body?.user?.backupVerified, true, 'backup verified');
  const f = await post('/auth/password/forgot', { email: m.email, useBackup: true });
  status(f, 200, 'forgot'); eq(f.body?.sentTo, backup[0] + '•••••@example.test', 'masked backup destination');
  const rc = await resetFor(m.email);
  check(new RegExp(`\\[mail\\] to=${esc(backup)} subject="Your Aknologia code: ${rc}"`).test(serverLog()), 'reset code mailed to backup inbox');
  status(await post('/auth/password/reset', { email: m.email, code: wrongCode(rc) }), 400, 'code-only check, wrong');
  status(await post('/auth/password/reset', { email: m.email, code: rc }), 200, 'code-only check, right');
  status(await post('/auth/password/reset', { email: m.email, code: rc, password: 'short' }), 400, 'weak new password');
  const np = PW();
  status(await post('/auth/password/reset', { email: m.email, code: rc, password: np }), 200, 'reset');
  status(await get('/me', { token: m.token }), 401, 'old session revoked');
  status(await post('/auth/login', { email: m.email, password: np, client: 'desktop' }), 200, 'login with new password');
  status(await post('/auth/login', { email: m.email, password: m.password, client: 'desktop' }), 401, 'old password fails');
  status(await post('/auth/password/reset', { email: m.email, code: rc, password: PW() }), 400, 'reset code reuse');
  const u = await post('/auth/password/forgot', { email: mail('ghost') });
  status(u, 200, 'forgot unknown email gives same 200');
});
await test('otp: change password needs current password + emailed code, revokes other sessions', async () => {
  const m = await addMember(A, 'chpw');
  const other = (await post('/auth/login', { email: m.email, password: m.password, client: 'desktop' })).body.token;
  status(await post('/me/password/start', { current: 'nope', new: PW() }, { token: m.token }), 400, 'wrong current');
  const np = PW();
  status(await post('/me/password/start', { current: m.password, new: np }, { token: m.token }), 200, 'start');
  const c = await otpFor(m.email, 'change_password');
  status(await post('/me/password/confirm', { code: wrongCode(c) }, { token: m.token }), 400, 'wrong code');
  status(await post('/me/password/confirm', { code: c }, { token: m.token }), 200, 'confirm');
  status(await get('/me', { token: m.token }), 200, 'current session kept');
  status(await get('/me', { token: other }), 401, 'other session revoked');
});

// ======================= INVITES =======================
await test('invites: seat limit returns 402; cancel frees a seat', async () => {
  const o = await newOrg('seats', { seats: 3 }); // starter, 3 seats, admin uses 1
  const e1 = mail('s1'), e2 = mail('s2'), e3 = mail('s3');
  const r1 = await post('/admin/members/invite', { emails: [e1, e2] }, { token: o.token });
  status(r1, 200, 'invite 2 of remaining 2');
  const r2 = await post('/admin/members/invite', { emails: [e3] }, { token: o.token });
  status(r2, 402, 'over seats'); eq(r2.body?.error, 'seats', 'error kind');
  const reinv = await post('/admin/members/invite', { emails: [e1] }, { token: o.token });
  check(reinv.status === 200, 're-inviting an already-pending invite needs no new seat (expected 200)', reinv.text);
  const id1 = sql1(`SELECT id FROM users WHERE email = ${q(e1)}`);
  const c = await del(`/admin/members/${id1}`, { token: o.token });
  status(c, 200, 'cancel invite'); eq(c.body?.cancelled, true, 'cancelled flag');
  eq(sql1(`SELECT count(*) FROM users WHERE email = ${q(e1)}`), '0', 'invited user row deleted');
  status(await post('/admin/members/invite', { emails: [e3] }, { token: o.token }), 200, 'seat freed after cancel');
});
await test('invites: cancelled invite code no longer works', async () => {
  const e = mail('cancel');
  await post('/admin/members/invite', { emails: [e] }, { token: A.token });
  const code = await inviteFor(e);
  const id = sql1(`SELECT id FROM users WHERE email = ${q(e)}`);
  await del(`/admin/members/${id}`, { token: A.token });
  status(await post('/auth/invite/accept', { email: e, code, password: PW(), client: 'desktop' }), 400, 'accept cancelled invite');
});
await test('invites: resend invalidates old code', async () => {
  const e = mail('resend');
  await post('/admin/members/invite', { emails: [e] }, { token: A.token });
  const c1 = await inviteFor(e);
  const id = sql1(`SELECT id FROM users WHERE email = ${q(e)}`);
  status(await post(`/admin/members/${id}/resend`, {}, { token: A.token }), 200, 'resend');
  await sleep(300);
  const c2 = await inviteFor(e);
  check(c1 !== c2, 'new code issued');
  status(await post('/auth/invite/accept', { email: e, code: c1, password: PW(), client: 'desktop' }), 400, 'old code');
  status(await post('/auth/invite/accept', { email: e, code: c2.toLowerCase().replace('-', ' '), password: PW(), client: 'desktop' }), 200, 'new code (typed loosely)');
  status(await post('/auth/invite/accept', { email: e, code: c2, password: PW(), client: 'desktop' }), 400, 'invite code reuse');
  status(await post(`/admin/members/${id}/resend`, {}, { token: A.token }), 400, 'resend for active member');
});
await test('invites: expired invite rejected', async () => {
  const e = mail('invexp');
  await post('/admin/members/invite', { emails: [e] }, { token: A.token });
  const c = await inviteFor(e);
  sql(`UPDATE invites SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email = ${q(e)})`);
  status(await post('/auth/invite/accept', { email: e, code: c, password: PW(), client: 'desktop' }), 400, 'expired invite');
});
await test('invites: code for another email rejected; weak password on accept rejected', async () => {
  const e1 = mail('mis1'), e2 = mail('mis2');
  await post('/admin/members/invite', { emails: [e1, e2] }, { token: A.token });
  const c1 = await inviteFor(e1), c2 = await inviteFor(e2);
  status(await post('/auth/invite/accept', { email: e1, code: c2, password: PW(), client: 'desktop' }), 400, 'code of e2 with email e1');
  status(await post('/auth/invite/accept', { email: e1, code: c1, password: 'weakpassword', client: 'desktop' }), 400, 'weak password');
  status(await post('/auth/invite/accept', { email: e1, code: c1, password: PW(), client: 'desktop' }), 200, 'correct pairing');
  const days = Number(sql1(`SELECT round(extract(epoch FROM expires_at - created_at)/86400) FROM invites WHERE user_id = (SELECT id FROM users WHERE email = ${q(e2)}) ORDER BY created_at DESC LIMIT 1`));
  eq(days, 14, 'invite valid for 14 days');
});
await test('invites: re-invite of a removed member', async () => {
  const m = await addMember(A, 'reinv');
  status(await del(`/admin/members/${m.userId}`, { token: A.token }), 200, 'remove');
  const lr = await post('/auth/login', { email: m.email, password: m.password, client: 'desktop' });
  eq(lr.body?.error, 'removed', 'removed login');
  const r = await post('/admin/members/invite', { emails: [m.email] }, { token: A.token });
  eq(r.body?.results?.[0]?.result, 'invited', 're-invite result');
  const c = await inviteFor(m.email);
  const old = (await post('/auth/login', { email: m.email, password: m.password, client: 'desktop' })).body;
  eq(old?.error, 'bad_credentials', 'old password no longer valid (no account-state hint without a valid password)');
  check(/I have an invite/.test(old?.message || ''), 'the message points invited people to the invite flow', old);
  const np = PW();
  status(await post('/auth/invite/accept', { email: m.email, code: c, password: np, client: 'desktop' }), 200, 'accept re-invite');
  status(await get('/me', { token: m.token }), 401, 'pre-removal token stays dead');
  status(await post('/auth/login', { email: m.email, password: np, client: 'desktop' }), 200, 'login after re-invite');
});
await test('invites: email of another org is refused', async () => {
  const B = await newOrg('other');
  const r = await post('/admin/members/invite', { emails: [A.email] }, { token: B.token });
  eq(r.body?.results?.[0]?.result, 'belongs_to_another_org', 'result');
});

// ======================= AUTHORIZATION =======================
const ADMIN_ROUTES = (id) => [
  ['GET', '/admin/overview'], ['GET', '/admin/members'], ['POST', '/admin/members/invite', { emails: [mail('x')] }],
  ['POST', `/admin/members/${id}/resend`, {}], ['PATCH', `/admin/members/${id}`, { role: 'admin' }], ['DELETE', `/admin/members/${id}`],
  ['GET', `/admin/members/${id}/usage`], ['GET', '/admin/budgets'], ['PUT', '/admin/budgets', { defaultBudget: 1 }], ['GET', '/admin/org'],
  ['PUT', '/admin/org', { name: 'pwned' }], ['GET', '/admin/billing'], ['POST', '/admin/billing/seats', { seats: 50, plan: 'team' }],
  ['POST', '/admin/refresh', {}], ['GET', '/admin/export.csv'], ['POST', '/admin/data/delete/start', {}], ['POST', '/admin/data/delete/confirm', { code: '123456' }],
  ['GET', '/admin/pricing'],
];
await test('authz: a member gets 403 on every /admin endpoint', async () => {
  const m = await addMember(A, 'authz');
  for (const [mth, p, b] of ADMIN_ROUTES(A.userId)) {
    const r = await call(mth, p, { token: m.token, body: b });
    check(r.status === 403 && r.body?.error === 'forbidden', `${mth} ${p} as member -> 403 forbidden`, `${r.status} ${r.text}`);
  }
  eq(sql1(`SELECT role FROM users WHERE id = ${q(A.userId)}`), 'admin', 'nothing changed');
  eq(sql1(`SELECT count(*) FROM otps WHERE user_id = ${q(m.userId)} AND purpose = 'delete_data'`), '0', 'no delete code issued');
});
await test('authz: admin of org A cannot read/change org B', async () => {
  const B = await newOrg('orgb');
  const mb = await addMember(B, 'orgbm', { budgetCents: 100 });
  await ingest(mb.token, [ev({ output: 20000 })]); // $1.50 crosses the $1 budget -> notifications for mb
  const eb = mail('orgbinv');
  await post('/admin/members/invite', { emails: [eb] }, { token: B.token });
  const ib = sql1(`SELECT id FROM users WHERE email = ${q(eb)}`);
  const ma = await addMember(A, 'orgam');
  check((await get(`/admin/members/${mb.userId}/usage`, { token: A.token })).status === 404, 'GET usage of B member -> 404');
  check((await patch(`/admin/members/${mb.userId}`, { budgetCents: 1, role: 'admin' }, { token: A.token })).status === 404, 'PATCH B member -> 404');
  check((await del(`/admin/members/${mb.userId}?deleteHistory=true`, { token: A.token })).status === 404, 'DELETE B member -> 404');
  check((await post(`/admin/members/${ib}/resend`, {}, { token: A.token })).status === 404, 'resend B invite -> 404');
  check((await del(`/admin/members/${ib}`, { token: A.token })).status === 404, 'cancel B invite -> 404');
  await put('/admin/budgets', { members: { [mb.userId]: 0.01 } }, { token: A.token });
  const row = sql(`SELECT role, status, coalesce(budget_cents::text,'null') FROM users WHERE id = ${q(mb.userId)}`)[0];
  eq(row.join(','), 'member,active,100', 'B member unchanged');
  check(Number(sql1(`SELECT count(*) FROM usage_events WHERE user_id = ${q(mb.userId)}`)) === 1, 'B usage intact');
  const all = [await get('/admin/overview', { token: A.token }), await get('/admin/members', { token: A.token }), await get('/admin/budgets', { token: A.token }),
    await get('/admin/export.csv?from=2020-01-01&to=2030-01-01', { token: A.token }), await get('/admin/org', { token: A.token })];
  for (const r of all) check(!r.text.includes(mb.userId) && !r.text.includes(mb.email) && !r.text.includes(B.email), 'A responses do not contain B data', r.text.slice(0, 200));
  const nb = (await notifs(mb.token))[0];
  check(!!nb, 'B member has a notification');
  await post(`/me/notifications/${nb.id}/read`, {}, { token: ma.token });
  eq((await notifs(mb.token))[0].read, false, 'A member cannot mark B notification read');
  await del(`/me/devices/${mb.deviceId}`, { token: ma.token });
  status(await get('/me', { token: mb.token }), 200, 'A member cannot revoke B device');
});
await test('authz: revoked device token, logout, expired token, removed member', async () => {
  const m = await addMember(A, 'tok');
  const t2 = (await post('/auth/login', { email: m.email, password: m.password, client: 'desktop', deviceName: 'second' })).body;
  status(await del(`/me/devices/${t2.deviceId}`, { token: m.token }), 200, 'revoke device 2');
  status(await get('/agent/config', { token: t2.token }), 401, 'revoked device token');
  status(await ingest(t2.token, [ev({})]), 401, 'revoked device cannot ingest');
  const t3 = (await post('/auth/login', { email: m.email, password: m.password, client: 'desktop' })).body.token;
  status(await post('/auth/logout', {}, { token: t3 }), 200, 'logout');
  status(await get('/me', { token: t3 }), 401, 'logged-out token');
  const t4 = (await post('/auth/login', { email: m.email, password: m.password, client: 'desktop' })).body.token;
  sql(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = ${q(sha256(t4))}`);
  status(await get('/me', { token: t4 }), 401, 'expired token');
  const ttl = Number(sql1(`SELECT round(extract(epoch FROM expires_at - created_at)/86400) FROM sessions WHERE token_hash = ${q(sha256(m.token))}`));
  eq(ttl, 180, 'desktop session 180 days');
  const webTtl = Number(sql1(`SELECT round(extract(epoch FROM expires_at - created_at)/86400) FROM sessions WHERE token_hash = ${q(sha256(A.token))}`));
  eq(webTtl, 14, 'web session 14 days');
  status(await del(`/admin/members/${m.userId}`, { token: A.token }), 200, 'remove member');
  for (const [mth, p, b] of [['GET', '/me'], ['GET', '/agent/config'], ['POST', '/ingest/batch', { events: [ev({})] }], ['GET', '/me/usage']]) {
    const r = await call(mth, p, { token: m.token, body: b });
    check(r.status === 403 && r.body?.error === 'removed', `${mth} ${p} as removed -> 403 removed`, `${r.status} ${r.text}`);
  }
  eq(sql1(`SELECT count(*) FROM sessions WHERE user_id = ${q(m.userId)} AND revoked_at IS NULL`), '0', 'all sessions revoked');
  eq(sql1(`SELECT count(*) FROM devices WHERE user_id = ${q(m.userId)} AND revoked_at IS NULL`), '0', 'all devices revoked');
  const self = await del(`/admin/members/${A.userId}`, { token: A.token });
  status(self, 400, 'admin cannot remove self');
});
await test('authz: token accepted without "Bearer " prefix (note)', async () => {
  const r = await call('GET', '/me', { auth: A.token });
  check(r.status === 401, 'raw token without Bearer scheme should be rejected', `${r.status}`);
});

// ======================= INGEST =======================
let I; // member used for ingest tests
await test('ingest: same batch twice is idempotent', async () => {
  I = await addMember(A, 'ing');
  const batch = [ev({ output: 1 }), ev({ output: 2 }), ev({ output: 3 })];
  const r1 = await ingest(I.token, batch);
  eq(JSON.stringify(r1.body), JSON.stringify({ accepted: 3, duplicates: 0, rejected: 0, updated: 0 }), 'first');
  const r2 = await ingest(I.token, batch);
  eq(JSON.stringify(r2.body), JSON.stringify({ accepted: 0, duplicates: 3, rejected: 0, updated: 0 }), 'second');
  eq(sql1(`SELECT count(*) FROM usage_events WHERE user_id = ${q(I.userId)}`), '3', 'rows in DB');
  eq(sql1(`SELECT sum(events) FROM daily_usage WHERE user_id = ${q(I.userId)}`), '3', 'rollup counts 3');
});
await test('ingest: malformed batches and events rejected', async () => {
  status(await call('POST', '/ingest/batch', { token: I.token, raw: '{"events":[' }), 400, 'truncated JSON');
  status(await call('POST', '/ingest/batch', { token: I.token, raw: '{"events":{"a":1}}' }), 400, 'events not an array');
  status(await call('POST', '/ingest/batch', { token: I.token, raw: '{"events":[{"input":"lots"}]}' }), 400, 'string token count');
  const noSess = ev({}); noSess.sessionId = '';
  const noMsg = ev({}); noMsg.messageId = '';
  const nots = ev({}); delete nots.ts;
  const bad = [ev({ tool: 'cursor' }), noSess, noMsg, nots];
  const r = await ingest(I.token, bad);
  eq(JSON.stringify(r.body), JSON.stringify({ accepted: 0, duplicates: 0, rejected: 4, updated: 0 }), 'bad tool / no session / no message / no ts');
  const neg = [ev({ input: -1 }), ev({ output: -1 }), ev({ cw: -1 }), ev({ cr: -1 })];
  eq((await ingest(I.token, neg)).body?.rejected, 4, 'negative token counts rejected');
});
await test('ingest: 2001 events rejected, 2000 accepted', async () => {
  const big = Array.from({ length: 2001 }, (_, i) => ev({ session: 'big', msg: 'b' + i, output: 1 }));
  status(await ingest(I.token, big), 400, '2001 events');
  const r = await ingest(I.token, big.slice(0, 2000));
  status(r, 200, '2000 events'); eq(r.body?.accepted, 2000, 'accepted 2000');
});
await test('ingest: timestamps far past / future rejected', async () => {
  const r = await ingest(I.token, [ev({ ts: Date.now() - 3 * 365 * D }), ev({ ts: Date.now() + 2 * D }), ev({ ts: '1970-01-01T00:00:00Z' })]);
  eq(r.body?.rejected, 3, '3 years ago, +2 days, epoch');
  const soon = await ingest(I.token, [ev({ ts: Date.now() + 23 * H, output: 1 })]);
  check(soon.body?.accepted === 0, 'events 23 h in the future should be rejected (they count toward spend/budgets now)', soon.text);
});
await test('ingest: events attributed only to the token user', async () => {
  const other = await addMember(A, 'victim');
  const e = ev({ output: 5, extra: { userId: other.userId, user_id: other.userId, deviceId: other.deviceId, email: other.email } });
  eq((await ingest(I.token, [e], { userId: other.userId })).body?.accepted, 1, 'accepted');
  eq(sql1(`SELECT user_id FROM usage_events WHERE message_id = ${q(e.messageId)}`), I.userId, 'stored for token user');
  eq(sql1(`SELECT count(*) FROM usage_events WHERE user_id = ${q(other.userId)}`), '0', 'victim untouched');
  // Same dedup key from two users are separate rows (PK includes user_id).
  eq((await ingest(other.token, [e])).body?.accepted, 1, 'same ids accepted for another user');
});
await test('ingest: huge token counts poison the member rollup (bigint overflow)', async () => {
  const logStart = serverLog().length; // only look at log lines written during this test
  const PO = await newOrg('poison');
  const bystander = await addMember(PO, 'bystander');
  const p = await addMember(PO, 'poison');
  await ingest(p.token, [ev({ output: 10000 })]); // $0.75
  const before = sql1(`SELECT sum(cost_micros) FROM daily_usage WHERE user_id = ${q(p.userId)}`);
  const r = await ingest(p.token, [ev({ session: 'x', input: 5e18 }), ev({ session: 'x', input: 5e18 })]);
  check(r.body?.accepted === 0, 'absurd token counts (5e18) should be rejected', r.text);
  await ingest(p.token, [ev({ output: 10000 })]); // another $0.75
  const after = sql1(`SELECT sum(cost_micros) FROM daily_usage WHERE user_id = ${q(p.userId)}`);
  check(after !== before, `rollup must keep working after a bad batch; daily_usage cost stayed ${before} -> ${after}`);
  await ingest(bystander.token, [ev({ output: 10000 })]);
  const rf = await post('/admin/refresh', {}, { token: PO.token });
  check(rf.status === 200, 'Refresh data for the whole org must still work', `${rf.status} ${rf.text}`);
  check(!/converting driver.Value type \[\]uint8 \("10000000000000000000"\) to a int64: value out of range/.test(serverLog().slice(logStart)), 'no int64 overflow in the server log (fixed: tokens per event are capped)');
});

// ======================= ROLLUP WINDOW / TIMEZONES =======================
await test('rollup: events older than 40 days are accepted but not counted until Refresh', async () => {
  const o = await newOrg('old');
  const m = await addMember(o, 'oldm');
  const ts = Date.now() - 60 * D;
  const r = await ingest(m.token, [ev({ ts, output: 10000 })]);
  eq(r.body?.accepted, 1, 'accepted');
  const month = utcDate(ts).slice(0, 7);
  const before = (await get(`/admin/overview?month=${month}`, { token: o.token })).body?.kpis?.spend;
  check(before === 0.75, `overview for ${month} should show $0.75 right after ingest, got ${before}`);
  await post('/admin/refresh', {}, { token: o.token });
  eq((await get(`/admin/overview?month=${month}`, { token: o.token })).body?.kpis?.spend, 0.75, 'after Refresh');
});
async function boundaryOrg(tz) {
  const o = await newOrg('tz' + tz.split('/')[1].slice(0, 4).toLowerCase(), { tz });
  const m = await addMember(o, 'tzm');
  const sinceDate = utcDate(Date.now() - 40 * D);
  return { o, m, boundary: Date.parse(sinceDate + 'T00:00:00Z'), sinceDate };
}
await test('rollup: America/New_York org - later ingests stop updating totals (daily_usage PK conflict)', async () => {
  const logStart = serverLog().length;
  const { o, m, boundary } = await boundaryOrg('America/New_York');
  eq((await ingest(m.token, [ev({ ts: boundary + 1 * H, output: 10000 })])).body?.accepted, 1, 'event 40 days ago (01:00Z = previous local day)');
  const r = await ingest(m.token, [ev({ output: 20000 })]); // $1.50 now
  eq(r.body?.accepted, 1, 'event now accepted');
  const today = sql1(`SELECT coalesce(sum(cost_micros),0) FROM daily_usage WHERE user_id = ${q(m.userId)} AND day >= (now() AT TIME ZONE 'America/New_York')::date - 1`);
  check(today === '1500000', `today's $1.50 should be in daily_usage; got ${today} micros`);
  const spend = (await get(`/admin/members/${m.userId}/usage`, { token: o.token })).body?.kpis?.spend;
  check(spend === 1.5, `member spend this month should be 1.5, got ${spend}`);
  check(!/rollup: pq: duplicate key value violates unique constraint "daily_usage_pkey"/.test(serverLog().slice(logStart)), 'no rollup PK conflict in the server log (fixed)');
  await ingest(m.token, [ev({ output: 10000 })]);
  const still = (await get(`/admin/members/${m.userId}/usage`, { token: o.token })).body?.kpis?.spend;
  check(still === 2.25, `after a third ingest spend should be 2.25, got ${still}`);
  status(await post('/admin/refresh', {}, { token: o.token }), 200, 'Refresh (workaround)');
  eq((await get(`/admin/members/${m.userId}/usage`, { token: o.token })).body?.kpis?.spend, 2.25, 'spend correct after Refresh');
});
await test('rollup: Asia/Kolkata org - event early on the oldest day is dropped from daily_usage', async () => {
  const { o, m, boundary, sinceDate } = await boundaryOrg('Asia/Kolkata');
  const ts = boundary - 1 * H; // 23:00Z the day before = 04:30 IST on sinceDate
  eq((await ingest(m.token, [ev({ ts, output: 10000 })])).body?.accepted, 1, 'accepted');
  const got = sql1(`SELECT coalesce(sum(cost_micros),0) FROM daily_usage WHERE user_id = ${q(m.userId)} AND day = ${q(sinceDate)}`);
  check(got === '750000', `daily_usage for ${sinceDate} (IST) should hold $0.75, got ${got} micros`);
  const csv = (await get(`/admin/export.csv?from=${sinceDate}&to=${utcDate(boundary + 2 * D)}`, { token: o.token })).text;
  check(csv.includes(m.email), 'export should contain the event', csv);
});

await test('time: month boundary in Asia/Kolkata (18:29Z vs 18:31Z on the last day)', async () => {
  const o = await newOrg('ist', { tz: 'Asia/Kolkata' });
  const m = await addMember(o, 'istm');
  const istNow = new Date(Date.now() + 5.5 * H);
  const monthStartUtc = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) - 5.5 * H; // 00:00 IST on the 1st
  const prev = new Date(monthStartUtc - 60e3), next = new Date(monthStartUtc + 60e3);
  check(prev.toISOString().endsWith('18:29:00.000Z') && next.toISOString().endsWith('18:31:00.000Z'), 'crafted 18:29Z / 18:31Z', [prev, next]);
  await ingest(m.token, [ev({ ts: prev, output: 10000, session: 'b1' }), ev({ ts: next, output: 20000, session: 'b2' })]);
  const curMonth = new Date(monthStartUtc + 6 * H).toISOString().slice(0, 7);
  const prevMonth = prev.toISOString().slice(0, 7);
  const cur = (await get('/admin/overview', { token: o.token })).body;
  const old = (await get(`/admin/overview?month=${prevMonth}`, { token: o.token })).body;
  eq(cur?.kpis?.spend, 1.5, `current month ${curMonth} has only the 18:31Z event`);
  eq(old?.kpis?.spend, 0.75, `previous month ${prevMonth} has only the 18:29Z event`);
  eq((await get(`/admin/members/${m.userId}/usage?month=${prevMonth}`, { token: o.token })).body?.kpis?.spend, 0.75, 'member usage previous month');
  eq((await get(`/admin/members/${m.userId}/usage`, { token: o.token })).body?.kpis?.spend, 1.5, 'member usage current month');
  eq((await get('/agent/config', { token: m.token })).body?.budget?.spentCents, 150, 'budget spent this month (cents)');
  const csv = (await get(`/admin/export.csv?from=${prevMonth}-01&to=${curMonth}-28`, { token: o.token })).text.split('\n').filter((l) => l.includes(m.email));
  check(csv.some((l) => l.startsWith(prev.toISOString().slice(0, 10) + ',') && l.endsWith(',0.7500')), 'CSV row on last day of month = 0.75', csv);
  check(csv.some((l) => l.startsWith(curMonth + '-01,') && l.endsWith(',1.5000')), 'CSV row on the 1st = 1.50', csv);
  eq(cur?.dailyActive?.[0]?.day, curMonth + '-01', 'dailyActive first day is the 1st (IST)');
});

// ======================= MONEY AND TIME =======================
await test('money: hand-computed cost matches overview, member usage, /me/usage and CSV to the cent', async () => {
  const o = await newOrg('money');
  const m = await addMember(o, 'moneym');
  const pricing = (await get('/admin/pricing', { token: o.token })).body;
  const dbPricing = sql(`SELECT model, input, output, cache_write_5m, cache_read FROM model_prices ORDER BY model`);
  eq(pricing.models.length, dbPricing.length, 'GET admin/pricing matches DB row count');
  for (const r of dbPricing) {
    const p = pricing.models.find((x) => x.model === r[0]);
    check(p && p.input === +r[1] && p.output === +r[2] && (p.cacheWrite5m || 0) === +r[3] && p.cacheRead === +r[4], `pricing row ${r[0]} matches DB`, [p, r]);
  }
  const t = Date.now() - 3 * H;
  const batch = [
    ev({ model: 'claude-opus-5-5', input: 1234, output: 5678, cw: 9012, cr: 34567, ts: t }),
    ev({ model: 'claude-opus-5-5', input: 1, output: 3, cw: 7, cr: 11, ts: t + 1000 }),
    ev({ model: 'Claude-Sonnet-4-5', input: 100000, output: 20000, cw: 5000, cr: 300000, ts: t + 2000 }),
    ev({ model: 'claude-haiku-4-5', input: 77777, output: 3333, cw: 0, cr: 999, ts: t + 3000 }),
    ev({ tool: 'codex', model: 'gpt-5-codex', input: 50000, output: 12345, cr: 40000, ts: t + 4000 }),
    ev({ tool: 'codex', model: 'gpt-4.1', input: 1000, output: 1000, ts: t + 5000 }),
    ev({ model: 'mystery-model-x', input: 1000000, ts: t + 6000 }),
    ev({ model: '', input: 333333, output: 4444, ts: t + 7000 }),
  ];
  eq((await ingest(m.token, batch)).body?.accepted, batch.length, 'accepted');
  const groups = {};
  for (const e of batch) { const k = e.tool + '|' + e.model; groups[k] = (groups[k] || 0) + costMicros(pricing, e); }
  const expMicros = batch.reduce((s, e) => s + costMicros(pricing, e), 0);
  const exp = toUsd(expMicros);
  const expSaved = toUsd(batch.reduce((s, e) => s + savingsMicros(pricing, e), 0));
  console.log(`      expected spend $${exp} (${expMicros} micro-$), saved $${expSaved}`);
  const ov = (await get('/admin/overview', { token: o.token })).body;
  eq(ov.kpis.spend, exp, 'overview kpis.spend');
  eq(ov.members.find((x) => x.id === m.userId)?.spend, exp, 'overview member row spend');
  eq(ov.kpis.saved, expSaved, 'overview saved by caching');
  const mu = (await get(`/admin/members/${m.userId}/usage`, { token: o.token })).body;
  eq(mu.kpis.spend, exp, 'member usage kpis.spend');
  const me = (await get('/me/usage?days=7', { token: m.token })).body;
  eq(me.costUsd, exp, '/me/usage costUsd'); eq(me.savedUsd, expSaved, '/me/usage savedUsd');
  eq(me.tokens, batch.reduce((s, e) => s + e.input + e.output + e.cacheWrite + e.cacheRead, 0), '/me/usage tokens');
  eq(me.budget.spentCents, Math.floor(expMicros / 1e4), 'budget spentCents');
  const csv = (await get('/admin/export.csv', { token: o.token })).text.trim().split('\n');
  eq(csv[0], 'day,email,name,tool,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cost_usd', 'CSV header');
  const rows = csv.slice(1).filter((l) => l.includes(m.email)).map((l) => l.split(','));
  eq(rows.length, Object.keys(groups).length, 'CSV row per tool+model');
  eq(toUsd(rows.reduce((s, r) => s + Number(r[9]) * 1e6, 0)), exp, 'CSV cost sum');
  for (const r of rows) {
    const k = r[3] + '|' + r[4];
    check(Math.abs(Number(r[9]) - groups[k] / 1e6) < 0.0001, `CSV cost for ${k}`, [r[9], groups[k] / 1e6]);
  }
  for (const mm of me.models) {
    const k = Object.keys(groups).find((g) => g.split('|')[1] === mm.model || (mm.model === 'Claude (unknown model)' && g === 'claude_code|'));
    check(k && mm.cost === toUsd(groups[k]), `model breakdown ${mm.model}`, [mm, k && toUsd(groups[k])]);
  }
});
await test('time: active-time rule (gaps <= 5 min summed, longer gap or first turn = 30 s)', async () => {
  const o = await newOrg('active');
  const m = await addMember(o, 'actm');
  const t0 = Date.now() - 3 * H;
  const evs = [];
  for (let i = 0; i < 60; i++) evs.push(ev({ session: 'act', ts: t0 + i * 60e3, output: 1 }));    // 0..59 min: 30 + 59*60 = 3570
  evs.push(ev({ session: 'act', ts: t0 + 64 * 60e3, output: 1 }));                                // gap exactly 5:00 -> +300
  evs.push(ev({ session: 'act', ts: t0 + 70 * 60e3 + 30e3, output: 1 }));                         // gap 6:30 -> +30
  evs.push(ev({ session: 'act2', ts: t0 + 10 * 60e3, output: 1 }));                               // separate session, single turn -> +30
  evs.push(ev({ session: 'act2', ts: t0 + 10 * 60e3 + 299e3, output: 1 }));                       // gap 4:59 -> +299
  await ingest(m.token, evs);
  const expected = 3570 + 300 + 30 + 30 + 299; // 4229 s
  const mu = (await get(`/admin/members/${m.userId}/usage`, { token: o.token })).body;
  eq(mu.kpis.activeHours, Math.round(expected / 360) / 10, `activeHours for ${expected}s`);
  eq(mu.kpis.sessions, 2, 'sessions');
  const s1 = mu.sessions.find((s) => s.tool === 'claude_code' && s.activeMinutes > 30);
  eq(s1?.activeMinutes, Math.round(3900 / 60), 'session 1 activeMinutes (3900 s)');
  const s2 = mu.sessions.find((s) => s !== s1);
  eq(s2?.activeMinutes, Math.round(329 / 60), 'session 2 activeMinutes (329 s)');
  const secs = Number(sql1(`WITH e AS (SELECT ts, lag(ts) OVER (PARTITION BY session_id ORDER BY ts) prev FROM usage_events WHERE user_id = ${q(m.userId)})
    SELECT sum(CASE WHEN prev IS NOT NULL AND ts - prev <= interval '5 minutes' THEN extract(epoch FROM ts - prev) ELSE 30 END) FROM e`));
  eq(secs, expected, 'server SQL rule gives exactly the hand-computed seconds');
  eq((await get('/me/usage?days=7', { token: m.token })).body?.activeHours, Math.round(expected / 360) / 10, '/me/usage activeHours');
});

// ======================= BUDGETS =======================
await test('budgets: 80% then 100% alert exactly once each; inboxes respected', async () => {
  const o = await newOrg('budget');
  const fin = mail('fin'), ops = mail('ops');
  const b = await put('/admin/budgets', { inboxes: [fin, ops.toUpperCase()] }, { token: o.token });
  eq(JSON.stringify(b.body?.inboxes), JSON.stringify([fin, ops]), 'inboxes saved (normalised)');
  const m = await addMember(o, 'budm', { budgetCents: 1000 }); // $10
  await ingest(m.token, opusOut(10, 'b1'));                    // $7.50 = 75%
  eq(alertRows(m.userId).length, 0, 'no alert at 75%');
  await ingest(m.token, opusOut(1, 'b2'));                     // $8.25 = 82.5%
  eq(alertRows(m.userId).map((r) => r[0]).join(), '80', '80% alert');
  eq(alertRows(m.userId)[0]?.[1], `${fin}, ${ops}`, 'sent_to = inboxes');
  await ingest(m.token, opusOut(2, 'b3'));                     // $9.75
  eq(alertRows(m.userId).length, 1, 'still one alert at 97.5%');
  await ingest(m.token, opusOut(1, 'b4'));                     // $10.50
  eq(alertRows(m.userId).map((r) => r[0]).join(), '80,100', '100% alert');
  await ingest(m.token, opusOut(3, 'b5'));
  await post('/admin/refresh', {}, { token: o.token });
  eq(alertRows(m.userId).length, 2, 'no repeats after more usage and Refresh');
  const n = await notifs(m.token);
  eq(n.length, 2, 'two notifications'); eq(n.map((x) => x.kind).sort().join(), 'budget_100,budget_80', 'notification kinds');
  const mails80 = countLog(`\\[mail\\] to=${esc(fin)},${esc(ops)} subject="${esc(m.email)} reached 80% of their budget"`);
  const mails100 = countLog(`\\[mail\\] to=${esc(fin)},${esc(ops)} subject="${esc(m.email)} reached 100% of their budget"`);
  eq(mails80, 1, 'one 80% email to inboxes'); eq(mails100, 1, 'one 100% email to inboxes');
  eq(countLog(`\\[mail\\] to=${esc(o.email)} subject="${esc(m.email)} reached`), 0, 'admin (not an inbox) not emailed');
});
await test('budgets: PATCH member budget resets this month\'s alerts', async () => {
  const o = await newOrg('reset');
  const m = await addMember(o, 'rstm', { budgetCents: 1000 });
  await ingest(m.token, opusOut(15, 'r1'));                    // $11.25 -> 80 + 100
  eq(alertRows(m.userId).length, 2, 'both alerts');
  status(await patch(`/admin/members/${m.userId}`, { budgetCents: 2000 }, { token: o.token }), 200, 'raise to $20');
  const forBudget = (c) => sql(`SELECT threshold FROM budget_alerts WHERE user_id = ${q(m.userId)} AND budget_cents = ${c} ORDER BY threshold`).map((r) => r[0]).join();
  eq(alertRows(m.userId).length, 2, 'alert history kept (QA ADM-05)');
  await ingest(m.token, opusOut(1, 'r2'));                     // $12 = 60%
  eq(forBudget(2000), '', 'no alert at 60% of new budget');
  await ingest(m.token, opusOut(10, 'r3'));                    // $19.50 = 97.5%
  eq(forBudget(2000), '80', 'fresh 80% for new budget');
  eq((await notifs(m.token)).length, 3, 'notifications: 2 old + 1 new');
});
await test('budgets: PUT admin/budgets per-member budget also resets alerts', async () => {
  const o = await newOrg('putb');
  const m = await addMember(o, 'putm', { budgetCents: 1000 });
  await ingest(m.token, opusOut(11, 'p1'));                    // $8.25 -> 80
  eq(alertRows(m.userId).length, 1, '80% alert');
  await put('/admin/budgets', { members: { [m.userId]: 20 } }, { token: o.token });
  eq(sql1(`SELECT budget_cents FROM users WHERE id = ${q(m.userId)}`), '2000', 'budget changed to $20');
  await ingest(m.token, opusOut(12, 'p2'));                    // $17.25 = 86% of $20
  const rows = sql(`SELECT threshold, budget_cents FROM budget_alerts WHERE user_id = ${q(m.userId)}`);
  check(rows.some((r) => r[0] === '80' && r[1] === '2000'), 'an 80% alert for the new $20 budget should be sent', rows);
});
await test('budgets: alert_80 / alert_100 toggles respected; empty inboxes fall back to admins', async () => {
  const o = await newOrg('tog');
  await put('/admin/budgets', { alert80: false, inboxes: [] }, { token: o.token });
  const m = await addMember(o, 'togm', { budgetCents: 1000 });
  await ingest(m.token, opusOut(12, 't1'));                    // $9
  eq(alertRows(m.userId).length, 0, 'no 80% alert when alert_80 off');
  await ingest(m.token, opusOut(2, 't2'));                     // $10.50
  eq(alertRows(m.userId).map((r) => r[0]).join(), '100', 'only the 100% alert');
  eq(alertRows(m.userId)[0]?.[1], o.email, 'sent to admin when no inboxes');
  eq(countLog(`\\[mail\\] to=${esc(o.email)} subject="${esc(m.email)} reached 100% of their budget"`), 1, '100% email to admin');
  const o2 = await newOrg('tog2');
  await put('/admin/budgets', { alert100: false }, { token: o2.token });
  const m2 = await addMember(o2, 'tog2m', { budgetCents: 1000 });
  await ingest(m2.token, opusOut(16, 'u1'));                   // $12
  eq(alertRows(m2.userId).map((r) => r[0]).join(), '80', 'only the 80% alert when alert_100 off');
  eq((await notifs(m2.token)).length, 1, 'one notification');
});

// ======================= DELETION =======================
await test('data deletion requires emailed code; scoped to the org', async () => {
  const o = await newOrg('del');
  const m = await addMember(o, 'delm');
  const keep = await newOrg('keep'); const km = await addMember(keep, 'keepm');
  await ingest(m.token, opusOut(3, 'd1')); await ingest(km.token, opusOut(2, 'k1'));
  status(await post('/admin/data/delete/confirm', { code: '000000' }, { token: o.token }), 400, 'confirm without start');
  status(await post('/admin/data/delete/start', {}, { token: o.token }), 200, 'start');
  const c = await otpFor(o.email, 'delete_data');
  status(await post('/admin/data/delete/confirm', { code: wrongCode(c) }, { token: o.token }), 400, 'wrong code');
  eq(sql1(`SELECT count(*) FROM usage_events WHERE user_id = ${q(m.userId)}`), '3', 'data still there');
  status(await post('/admin/data/delete/confirm', { code: c }, { token: o.token }), 200, 'confirm');
  eq(sql1(`SELECT count(*) FROM usage_events e JOIN users u ON u.id = e.user_id WHERE u.org_id = ${q(o.orgId)}`), '0', 'org events deleted');
  eq(sql1(`SELECT count(*) FROM daily_usage WHERE user_id = ${q(m.userId)}`), '0', 'org rollups deleted');
  eq(sql1(`SELECT count(*) FROM usage_events WHERE user_id = ${q(km.userId)}`), '2', 'other org untouched');
  eq((await get('/admin/overview', { token: o.token })).body?.kpis?.spend, 0, 'overview now 0');
});
await test('removal: deleteHistory=true deletes usage, default keeps it', async () => {
  const o = await newOrg('rm');
  const m1 = await addMember(o, 'rm1'), m2 = await addMember(o, 'rm2');
  await ingest(m1.token, opusOut(2, 'x1')); await ingest(m2.token, opusOut(2, 'x2'));
  status(await del(`/admin/members/${m1.userId}?deleteHistory=true`, { token: o.token }), 200, 'remove + delete history');
  status(await del(`/admin/members/${m2.userId}`, { token: o.token }), 200, 'remove, keep history');
  eq(sql1(`SELECT count(*) FROM usage_events WHERE user_id = ${q(m1.userId)}`) + '/' + sql1(`SELECT count(*) FROM daily_usage WHERE user_id = ${q(m1.userId)}`), '0/0', 'm1 usage deleted');
  eq(sql1(`SELECT count(*) FROM usage_events WHERE user_id = ${q(m2.userId)}`), '2', 'm2 usage kept');
  eq((await get('/admin/overview', { token: o.token })).body?.kpis?.spend, 1.5, 'overview keeps removed member spend');
  check(countLog(`\\[mail\\] to=${esc(m1.email)} subject="You’ve been removed from`) === 1, 'removal email sent');
});

// ======================= HEADERS / EXTRA =======================
await test('headers: CORS only for allowed origins; nosniff', async () => {
  const h = async (origin, method = 'GET') => (await fetch(API + '/health', { method, headers: { origin } })).headers;
  check((await h('https://evil.example')).get('access-control-allow-origin') === null, 'no ACAO for https://evil.example');
  check((await h('https://evil.example', 'OPTIONS')).get('access-control-allow-origin') === null, 'no ACAO on preflight for evil');
  eq((await h('http://localhost:5173')).get('access-control-allow-origin'), 'http://localhost:5173', 'dev origin allowed');
  const tricky = ['http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'http://localhost:8080.evil.example'];
  for (const t of tricky) check((await h(t)).get('access-control-allow-origin') === null, `no ACAO for look-alike origin ${t}`, (await h(t)).get('access-control-allow-origin'));
  const r = await fetch(API + '/me');
  eq(r.headers.get('x-content-type-options'), 'nosniff', 'nosniff on API 401');
  eq((await fetch(API + '/health')).headers.get('x-content-type-options'), 'nosniff', 'nosniff on health');
  eq((await fetch(BASE + '/app/')).headers.get('x-content-type-options'), 'nosniff', 'nosniff on /app/');
});
await test('csv: export neutralises spreadsheet formulas in member names', async () => {
  const m = await addMember(A, 'csv');
  await patch('/me/settings', { name: '=HYPERLINK("http://evil.example","click")' }, { token: m.token });
  await ingest(m.token, [ev({ output: 1 })]);
  const csv = (await get('/admin/export.csv', { token: A.token })).text;
  const line = csv.split('\n').find((l) => l.includes(m.email));
  check(line && !/,"?=HYPERLINK/.test(line), 'cell starting with = should be escaped (e.g. prefixed with \')', line);
});
await test('csv: invalid from/to date gives 400, not 500', async () => {
  const r = await get('/admin/export.csv?from=notadate', { token: A.token });
  check(r.status === 400, 'bad date', `${r.status} ${r.text}`);
});
await test('billing: rejected Starter downgrade must not change the plan', async () => {
  const o = await newOrg('bill'); // team, 10 seats
  const r = await post('/admin/billing/seats', { seats: 10, plan: 'starter' }, { token: o.token });
  status(r, 400, 'starter with 10 seats');
  const b = (await get('/admin/billing', { token: o.token })).body;
  check(b.plan === 'team' && b.seats === 10, 'plan should stay team/10 after a rejected change', { plan: b.plan, seats: b.seats });
});
await test('login: account state leaks without a correct password (enumeration, note)', async () => {
  const m = await addMember(A, 'enum');
  await del(`/admin/members/${m.userId}`, { token: A.token });
  const r = await post('/auth/login', { email: m.email, password: 'wrong-password-1!', client: 'desktop' });
  check(r.status === 401, 'wrong password for a removed account should look like any bad login', `${r.status} ${r.text}`);
  const e = mail('enuminv');
  await post('/admin/members/invite', { emails: [e] }, { token: A.token });
  const r2 = await post('/auth/login', { email: e, password: 'wrong-password-1!', client: 'desktop' });
  check(r2.status === 401, 'wrong password for an invited account should look like any bad login', `${r2.status} ${r2.text}`);
});

// ======================= SECRETS AT REST / IN RESPONSES =======================
await test('secrets: DB stores only hashes; no plaintext passwords/tokens/invite codes', async () => {
  eq(sql1(`SELECT count(*) FROM users WHERE password_hash IS NOT NULL AND password_hash !~ '^pbkdf2_sha256\\$600000\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}$'`), '0', 'all password hashes are PBKDF2 600k, 16-byte salt');
  for (const [t, c] of [['sessions', 'token_hash'], ['otps', 'code_hash'], ['invites', 'code_hash']])
    eq(sql1(`SELECT count(*) FROM ${t} WHERE ${c} !~ '^[0-9a-f]{64}$'`), '0', `${t}.${c} all SHA-256 hex`);
  const dump = pgDump();
  const uniq = [...new Set(secrets)].filter((s) => s.length >= 8);
  const leaked = uniq.filter((s) => dump.includes(s));
  eq(leaked.length, 0, `none of ${uniq.length} plaintext passwords/tokens/invite codes appear in pg_dump`);
  const codes = [...new Set(secrets)].filter((s) => /^\d{6}$/.test(s));
  const leakedCodes = codes.filter((c) => new RegExp(`(code|otp)[^\\n]{0,40}\\b${c}\\b`, 'i').test(dump));
  eq(leakedCodes.length, 0, `no 6-digit codes next to code/otp in dump (${codes.length} checked)`);
});
await test('secrets: no response body contains password_hash / code_hash / token_hash', async () => {
  const bad = bodies.filter((b) => /password_?hash|code_?hash|token_?hash|pbkdf2_sha256/i.test(b.text));
  eq(bad.length, 0, `grep over ${bodies.length} responses`);
  if (bad.length) console.log(bad.slice(0, 3));
});

// ======================= SUMMARY =======================
const passed = results.filter((r) => !r.fails.length).length;
const checks = results.reduce((s, r) => s + r.checks, 0), failedChecks = results.reduce((s, r) => s + r.fails.length, 0);
console.log(`\n${passed}/${results.length} tests passed, ${checks - failedChecks}/${checks} checks passed, ${results.length - passed} tests failed`);
writeFileSync(new URL('./last-run.json', import.meta.url), JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);
