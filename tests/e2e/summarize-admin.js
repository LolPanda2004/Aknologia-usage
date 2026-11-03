// Prints pass/fail per project and every recorded finding from test-results-admin/report.json
const r = require('./test-results-admin/report.json');
const out = [];
const walk = (s) => { (s.suites || []).forEach(walk); (s.specs || []).forEach((sp) => sp.tests.forEach((t) => out.push({ p: t.projectName, title: sp.title, st: (t.results.at(-1) || {}).status || 'skipped', err: ((t.results.at(-1) || {}).error?.message || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0], f: t.annotations.filter((a) => a.type === 'finding').map((a) => a.description) }))); };
walk(r);
const by = {};
for (const t of out) { const b = (by[t.p] ??= { passed: 0, failed: 0, skipped: 0 }); b[t.st === 'passed' ? 'passed' : t.st === 'skipped' ? 'skipped' : 'failed']++; }
console.log(JSON.stringify(by, null, 1));
for (const t of out) { if (t.st !== 'passed' && t.st !== 'skipped') console.log('FAIL', t.p, '|', t.title, '|', t.err.slice(0, 200)); for (const f of t.f) console.log('  F', t.p, '|', t.title.slice(0, 40), '|', f.slice(0, 220)); }
