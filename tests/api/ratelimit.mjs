// Rate-limit tests. Need a server with DEV_MODE=false (limiter is off in dev mode). See RESULTS.md for setup:
//   BASE=http://localhost:8091 LOGFILE=tests/api/.server-8091.log DB_CONTAINER=akn-qa1-db node tests/api/ratelimit.mjs
import { BASE, post, get, mail, PW, check, eq, status, test, results, serverLog, esc, sql1, q } from './lib.mjs';

console.log(`Target ${BASE}`);
const h = await get('/health');
if (h.status !== 200) { console.error('server not healthy'); process.exit(2); }

let authCallsSoFar = 0; // auth requests already counted against this IP by earlier tests
await test('prod mode without SMTP: no code is sent or logged, and the user is told why', async () => {
  const email = mail('nosmtp');
  const before = serverLog().length;
  const r = await post('/auth/signup', { name: 'No Smtp', email, company: 'Z' + Date.now(), password: PW() });
  authCallsSoFar++;
  check(r.status !== 429, 'run this test first on a fresh server (the limiter is per IP)', r.status);
  status(r, 503, 'signup reports that email is not set up');
  eq(r.body?.error, 'email_not_configured', 'error code');
  const added = serverLog().slice(before);
  check(!/\d{6}/.test(added.replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/g, '')), 'no six-digit code in the log', added);
});

await test('ratelimit: 21st auth request from one IP in 10 min gets 429', async () => {
  const email = mail('rl');
  const codes = [];
  const allowed = 20 - authCallsSoFar;
  for (let i = 0; i <= allowed; i++) codes.push((await post('/auth/login', { email, password: 'Wrong-password-1!', client: 'web' })).status);
  eq(codes.slice(0, allowed).every((c) => c === 401), true, `first ${allowed} are 401 (got ${codes.slice(0, allowed).join(',')})`);
  eq(codes[allowed], 429, '21st auth request from this IP is 429');
  const s = await post('/auth/signup', { name: 'X', email: mail('rl2'), company: 'Y', password: PW() });
  eq(s.status, 429, 'limit is shared across auth endpoints (signup now 429 too)');
  status(await get('/health'), 200, 'health not limited');
});
await test('ratelimit: spoofed X-Forwarded-For bypasses the limiter', async () => {
  const email = mail('rlx');
  const codes = [];
  for (let i = 0; i < 30; i++) {
    codes.push((await post('/auth/login', { email, password: 'Wrong-password-1!', client: 'web' }, { headers: { 'x-forwarded-for': `10.9.${i}.1` } })).status);
  }
  check(codes.filter((c) => c === 429).length > 0, `with a new X-Forwarded-For per request, 30 requests after the limit should still be 429; got ${[...new Set(codes)].join(',')}`);
});
const passed = results.filter((r) => !r.fails.length).length;
console.log(`\n${passed}/${results.length} tests passed`);
process.exit(passed === results.length ? 0 : 1);
