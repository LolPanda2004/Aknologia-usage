// Motion property lint: transitions and @keyframes may only use transform / opacity (+ colour properties for hover,
// and visibility as a discrete hide-after-slide helper). Exit 1 on anything else (width, height, top, box-shadow, filter…).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const allowed = new Set(['transform', 'opacity', 'color', 'background-color', 'border-color', 'fill', 'stroke', 'visibility']);
let bad = 0, n = 0;
const topSplit = (t) => { const out = []; let d = 0, cur = ''; for (const ch of t) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
const props = (list) => topSplit(list).map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
for (const f of ['ui/shared/theme.css', 'landing/index.html', 'landing/download/index.html']) {
  let s = fs.readFileSync(path.join(root, f), 'utf8');
  if (f.endsWith('.html')) s = [...s.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  for (const m of s.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)) {
    for (const p of props(m[1])) { n++; if (!allowed.has(p) && !/^(none|all|\.01ms|0ms)$/.test(p)) { bad++; console.log(`BAD transition in ${f}: ${p}`); } }
    if (/\ball\b/.test(m[1])) { bad++; console.log(`BAD transition: all in ${f}`); }
  }
  for (const m of s.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)) {
    for (const d of m[2].matchAll(/\{([^}]*)\}/g)) for (const decl of d[1].split(';')) {
      const p = decl.split(':')[0].trim(); if (!p) continue; n++;
      if (!allowed.has(p)) { bad++; console.log(`BAD keyframes ${m[1]} in ${f}: ${p}`); }
    }
  }
}
console.log(`motion lint: ${n} animated properties checked, ${bad} bad`);
process.exitCode = bad ? 1 : 0;
