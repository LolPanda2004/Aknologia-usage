// Writes COMPARE.md: before/after screenshot index per page at 390 and 1440, both themes, with the layout-problem
// count of each state (same definition as summarize.mjs). Run after `node summarize.mjs after`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (ph) => fs.readdirSync(path.join(here, 'results', ph)).filter((f) => f.endsWith('.json') && f !== 'registry.json').flatMap((f) => JSON.parse(fs.readFileSync(path.join(here, 'results', ph, f), 'utf8')));
const before = load('before'), after = load('after');
const count = (r) => {
  const m = r?.m; if (!m) return '–';
  return (m.hScroll ? 1 : 0) + m.overflow.length + m.offscreen.length + m.clipped.length + m.small.filter((s) => !s.inline).length + m.smallFont.length + m.dialogs.reduce((a, d) => a + d.problems.length, 0) + m.charts.length + (m.navHidden ? 1 : 0) + r.console.length;
};
const pages = [...new Set(after.map((r) => r.page))];
let md = `# Before / after screenshots\n\nGenerated ${new Date().toISOString()}. Paths are relative to this folder. Number in brackets = layout problems in that state\n(h-scroll + overflow + off-screen + clipped + tap < 44 + input font < 16 + dialog + chart + hidden nav + console; see \`summarize.mjs\`).\nModal and tour states are viewport shots; everything else is full page. Full matrix tables: \`results/after/summary.md\`.\n\n`;
md += `| Page | Width | Theme | Before | After |\n|---|---|---|---|---|\n`;
for (const p of pages) for (const w of ['390', '1440']) for (const t of ['light', 'dark']) {
  const a = after.find((r) => r.page === p && r.width === w && r.theme === t);
  const b = before.find((r) => r.page === p && r.width === w && r.theme === t);
  if (!a && !b) continue;
  const f = `${p}-${w}-${t}.png`;
  const has = (ph) => fs.existsSync(path.join(here, 'screenshots', ph, f));
  md += `| ${p} | ${w} | ${t} | ${has('before') ? `[before](screenshots/before/${f}) (${count(b)})` : '–'} | ${has('after') ? `[after](screenshots/after/${f}) (${count(a)})` : '–'} |\n`;
}
// desktop window at its minimum size
md += `\n## Desktop window at 960×640\n\n| Page | Theme | Before | After |\n|---|---|---|---|\n`;
for (const p of pages.filter((x) => x.startsWith('desk-'))) for (const t of ['light', 'dark']) {
  const f = `${p}-960x640-${t}.png`;
  const a = after.find((r) => r.page === p && r.width === '960x640' && r.theme === t), b = before.find((r) => r.page === p && r.width === '960x640' && r.theme === t);
  if (!a && !b) continue;
  md += `| ${p} | ${t} | [before](screenshots/before/${f}) (${count(b)}) | [after](screenshots/after/${f}) (${count(a)}) |\n`;
}
fs.writeFileSync(path.join(here, 'COMPARE.md'), md);
console.log('COMPARE.md written', pages.length, 'pages');
