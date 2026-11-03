// Save / restore originals for the responsive upgrade (there is no git repo).
//   node undo.mjs save <step> <repo-path>...   copy files to .originals/step-<step>/ (and .originals/pristine/ the first time)
//   node undo.mjs created <step> <repo-path>... record files that step created (deleted on undo)
//   node undo.mjs <step>                       restore that step (refuses if a later step is still applied)
//   node undo.mjs all                          restore pristine copies and delete every created file
//   node undo.mjs status                       list saved steps
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const base = path.join(here, '.originals');
const hash = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16) : null);
const stepDir = (n) => path.join(base, `step-${n}`);
const manifestOf = (n) => { const f = path.join(stepDir(n), 'manifest.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { saved: {}, created: [], undone: false }; };
const writeManifest = (n, m) => { fs.mkdirSync(stepDir(n), { recursive: true }); fs.writeFileSync(path.join(stepDir(n), 'manifest.json'), JSON.stringify(m, null, 2)); };
const steps = () => (fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('step-')).map((d) => Number(d.slice(5))).sort((a, b) => a - b) : []);
const safe = (rel) => { const abs = path.resolve(root, rel); if (!abs.startsWith(root + path.sep) || abs.includes(`${path.sep}tests${path.sep}responsive${path.sep}`)) throw new Error('refusing path ' + rel); return abs; };

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'save') {
  const [n, ...files] = args; const m = manifestOf(n);
  for (const rel of files) {
    const abs = safe(rel);
    if (m.saved[rel]) continue; // keep the state from before this step's first edit
    fs.mkdirSync(path.dirname(path.join(stepDir(n), rel)), { recursive: true });
    fs.copyFileSync(abs, path.join(stepDir(n), rel));
    const pristine = path.join(base, 'pristine', rel);
    if (!fs.existsSync(pristine)) { fs.mkdirSync(path.dirname(pristine), { recursive: true }); fs.copyFileSync(abs, pristine); }
    m.saved[rel] = { before: hash(abs) };
    console.log(`saved ${rel} -> step-${n}`);
  }
  writeManifest(n, m);
} else if (cmd === 'created') {
  const [n, ...files] = args; const m = manifestOf(n);
  for (const rel of files) { safe(rel); if (!m.created.includes(rel)) m.created.push(rel); }
  writeManifest(n, m);
} else if (cmd === 'status') {
  for (const n of steps()) { const m = manifestOf(n); console.log(`step ${n}${m.undone ? ' (undone)' : ''}: ${Object.keys(m.saved).join(', ')}${m.created.length ? ' | created: ' + m.created.join(', ') : ''}`); }
} else if (cmd === 'all') {
  for (const n of steps().reverse()) { const m = manifestOf(n); for (const rel of m.created) fs.rmSync(safe(rel), { force: true }); m.undone = true; writeManifest(n, m); }
  const pr = path.join(base, 'pristine');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  if (fs.existsSync(pr)) for (const f of walk(pr)) { const rel = path.relative(pr, f); fs.copyFileSync(f, safe(rel)); console.log('restored ' + rel); }
} else if (/^\d+$/.test(cmd ?? '')) {
  const n = Number(cmd);
  const later = steps().filter((s) => s > n && !manifestOf(s).undone);
  if (later.length) { console.error(`undo step(s) ${later.reverse().join(', ')} first`); process.exit(1); }
  const m = manifestOf(n);
  for (const [rel] of Object.entries(m.saved)) { fs.copyFileSync(path.join(stepDir(n), rel), safe(rel)); console.log('restored ' + rel); }
  for (const rel of m.created) { fs.rmSync(safe(rel), { force: true }); console.log('deleted ' + rel); }
  m.undone = true; writeManifest(n, m);
  console.log('Now run: cd ui && npm run typecheck && npm run build:admin && npm run build:desktop');
} else {
  console.log('usage: node undo.mjs save <step> <files...> | created <step> <files...> | <step> | all | status');
}
