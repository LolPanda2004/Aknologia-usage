// Summarises results/<PHASE>/*.json from audit.spec.ts.
//   node summarize.mjs [PHASE]   -> writes results/<PHASE>/summary.md and axe-<PHASE>.json (axe-baseline.json for "before")
//   node summarize.mjs after --compare before   -> also prints regressions vs the other phase (exit 1 if any)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2] ?? 'before';
const cmpIdx = process.argv.indexOf('--compare');
const other = cmpIdx > 0 ? process.argv[cmpIdx + 1] : null;

function load(ph) {
  const dir = path.join(here, 'results', ph);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'registry.json').flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
const rows = load(phase);
const widthOrder = ['320', '360', '390', '768', '960x640', '1024', '1280', '1440', '1920'];
const widths = widthOrder.filter((w) => rows.some((r) => r.width === w));
const pages = [...new Set(rows.map((r) => r.page))];

// per-row issue counts
function issues(r) {
  const m = r.m;
  if (!m) return { error: 1 };
  return {
    hscroll: m.hScroll ? 1 : 0,
    overflow: m.overflow.length,
    offscreen: m.offscreen.length,
    clipped: m.clipped.length,
    tap: m.small.filter((s) => !s.inline).length,
    font: m.smallFont.length,
    dialog: m.dialogs.reduce((a, d) => a + d.problems.length, 0),
    chart: m.charts.length,
    table: m.scrollers.length,
    nav: m.navHidden ? 1 : 0,
    console: r.console.length,
  };
}
const kinds = ['hscroll', 'overflow', 'offscreen', 'clipped', 'tap', 'font', 'dialog', 'chart', 'table', 'nav', 'console'];
const total = (i) => kinds.reduce((a, k) => a + (k === 'table' ? 0 : i[k] ?? 0), 0) + (i.error ?? 0);

let md = `# Responsive audit summary (${phase})\n\nGenerated ${new Date().toISOString()} from ${rows.length} page states.\n\n`;
md += `Counts = layout problems per page/width (max of both themes): h-scroll + overflow + off-screen + clipped + tap<44 (non-inline, ≤768 only) + input font<16 (≤768) + dialog + chart + hidden-nav + console. Tables that scroll are listed separately.\n\n`;
md += `| Page | ${widths.join(' | ')} |\n|---|${widths.map(() => '---:').join('|')}|\n`;
for (const p of pages) {
  md += `| ${p} | ${widths.map((w) => { const rs = rows.filter((r) => r.page === p && r.width === w); return rs.length ? Math.max(...rs.map((r) => total(issues(r)))) : '–'; }).join(' | ')} |\n`;
}
md += `\n## Totals by kind (all states)\n\n| Kind | States affected | Items |\n|---|---:|---:|\n`;
for (const k of kinds) { const af = rows.filter((r) => (issues(r)[k] ?? 0) > 0); md += `| ${k} | ${af.length} | ${af.reduce((a, r) => a + issues(r)[k], 0)} |\n`; }

// detail, grouped by kind + page + selector
const groups = new Map();
const add = (kind, r, sel, detail) => {
  const key = `${kind}|${r.page}|${sel}`;
  if (!groups.has(key)) groups.set(key, { kind, page: r.page, sel, detail, widths: new Set(), themes: new Set(), shot: r.shot });
  const g = groups.get(key); g.widths.add(r.width); g.themes.add(r.theme);
};
for (const r of rows) {
  const m = r.m; if (!m) { add('error', r, '-', r.error); continue; }
  if (m.hScroll) add('hscroll', r, 'html', `scrollWidth ${m.scrollW} > ${m.vw}; widest: ${(m.widest ?? []).slice(0, 2).map((x) => `${x.sel} → ${x.right}px "${x.text}"`).join('; ')}`);
  for (const o of m.overflow) add('overflow', r, o.sel, `+${o.by}px past parent "${o.text}"`);
  for (const o of m.offscreen) add('offscreen', r, o.sel, `[${o.left}..${o.right}] clipped by ${o.clippedBy} "${o.text}"`);
  for (const o of m.clipped) add('clipped', r, o.sel, `"${o.text}"`);
  for (const o of m.small.filter((s) => !s.inline)) add('tap', r, o.sel, `${o.w}×${o.h} "${o.text}"`);
  for (const o of m.smallFont) add('font', r, o.sel, `${o.px}px`);
  for (const d of m.dialogs) for (const p of d.problems) add('dialog', r, d.sel, p);
  for (const c of m.charts) add('chart', r, c.sel, c.problem);
  for (const s of m.scrollers) add('table', r, s.sel, `scroll ${s.scrollW} in ${s.clientW} (${s.visiblePct}% visible)`);
  if (m.navHidden) add('nav', r, 'nav.side', 'sidebar hidden, no menu button');
  for (const c of r.console) add('console', r, '-', c);
}
const order = (ws) => [...ws].sort((a, b) => widthOrder.indexOf(a) - widthOrder.indexOf(b)).join(',');
for (const k of ['error', ...kinds]) {
  const gs = [...groups.values()].filter((g) => g.kind === k);
  if (!gs.length) continue;
  md += `\n## ${k} (${gs.length})\n\n| Page | Widths | Themes | Selector | Detail | Screenshot |\n|---|---|---|---|---|---|\n`;
  for (const g of gs.slice(0, 400)) md += `| ${g.page} | ${order(g.widths)} | ${[...g.themes].join(',')} | \`${g.sel.replace(/\|/g, '\\|')}\` | ${String(g.detail).replace(/\|/g, '\\|').slice(0, 160)} | ${g.shot.replace(/-\d+(x\d+)?-(light|dark)\.png$/, `-<w>-<theme>.png`)} |\n`;
}
fs.writeFileSync(path.join(here, 'results', phase, 'summary.md'), md);

// axe
const axe = rows.filter((r) => r.axe).map((r) => ({ page: r.page, width: r.width, theme: r.theme, violations: r.axe }));
const axeFile = path.join(here, phase === 'before' ? 'axe-baseline.json' : `axe-${phase}.json`);
fs.writeFileSync(axeFile, JSON.stringify({ tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'], generated: new Date().toISOString(), scans: axe.length, violationsTotal: axe.reduce((a, x) => a + x.violations.length, 0), results: axe }, null, 2));
console.log(`summary: results/${phase}/summary.md · axe: ${path.basename(axeFile)} (${axe.length} scans, ${axe.reduce((a, x) => a + x.violations.length, 0)} violations)`);

// regressions vs another phase
if (other) {
  const prev = load(other);
  let bad = 0;
  for (const r of rows) {
    const p = prev.find((x) => x.page === r.page && x.width === r.width && x.theme === r.theme);
    if (!p) continue;
    const a = issues(r), b = issues(p);
    for (const k of kinds) if ((a[k] ?? 0) > (b[k] ?? 0) && k !== 'table') { bad++; console.log(`REGRESSION ${r.page} ${r.width} ${r.theme} ${k}: ${b[k] ?? 0} -> ${a[k]}`); }
    const av = new Set((r.axe ?? []).map((v) => v.id)), bv = new Set((p.axe ?? []).map((v) => v.id));
    for (const id of av) if (!bv.has(id)) { bad++; console.log(`AXE NEW ${r.page} ${r.width} ${r.theme}: ${id}`); }
  }
  console.log(bad ? `${bad} regressions` : 'no regressions');
  process.exitCode = bad ? 1 : 0;
}
