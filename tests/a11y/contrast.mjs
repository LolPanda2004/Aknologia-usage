// Computes WCAG contrast for the colour-token pairs the UI actually uses (ui/shared/theme.css and landing/index.html).
//   node tests/a11y/contrast.mjs   -> prints a table and writes tests/a11y/contrast.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const css = fs.readFileSync(path.join(root, 'ui/shared/theme.css'), 'utf8');
const land = fs.readFileSync(path.join(root, 'landing/index.html'), 'utf8');

function tokens(src, selector) {
  const i = src.indexOf(selector);
  const block = src.slice(src.indexOf('{', i) + 1, src.indexOf('}', i));
  const t = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) t[m[1]] = m[2].trim();
  return t;
}
const T = {
  dark: tokens(css, ":root, [data-theme='dark']"),
  light: tokens(css, "[data-theme='light']"),
};
const L = { dark: tokens(land, ":root, [data-theme='dark']"), light: tokens(land, "[data-theme='light']") };

function rgb(c) {
  c = c.trim();
  if (c.startsWith('#')) { const h = c.slice(1); return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)).concat(1); }
  const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p[3] ?? 1];
}
const blend = (fg, bg) => [0, 1, 2].map((k) => fg[k] * fg[3] + bg[k] * (1 - fg[3])).concat(1);
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

// [label, fg token or literal, bg token or literal, required ratio, where]
const PAIRS = [
  ['Body text', 'text', 'bg', 4.5, 'body'],
  ['Body text on card', 'text', 'surface', 4.5, '.card'],
  ['Secondary text on card', 'text2', 'surface', 4.5, '.text2'],
  ['Muted text on page', 'muted', 'bg', 4.5, '.muted, footer'],
  ['Muted text on card', 'muted', 'surface', 4.5, '.muted, .card-sub, th'],
  ['Muted text on inset', 'muted', 'inset', 4.5, 'Budgets total tiles, .hint in inputs'],
  ['Muted on raised (neutral pill text2)', 'text2', 'raised', 4.5, '.pill-neutral'],
  ['Muted on raised', 'muted', 'raised', 4.5, 'Checklist unchecked dot icon'],
  ['Muted on gold card', 'muted', 'gold-soft', 4.5, 'Settings "/ month" in gold card'],
  ['Muted on accent-soft', 'muted', 'accent-soft', 4.5, 'n/a check'],
  ['Link / accent ink on page', 'accent-ink', 'bg', 4.5, 'a, .link-btn'],
  ['Link / accent ink on card', 'accent-ink', 'surface', 4.5, '.link-btn in auth card'],
  ['Accent ink on accent-soft', 'accent-ink', 'accent-soft', 4.5, '.hero, .pill-accent, nav current, ribbon'],
  ['Primary button text', 'on-accent', 'accent', 4.5, '.btn-primary'],
  ['Danger button text', '#FFFFFF', 'danger', 4.5, '.btn-danger'],
  ['Danger outline / error text on card', 'red', 'surface', 4.5, '.btn-danger-outline, .error-text'],
  ['Red text on inset', 'red', 'inset', 4.5, 'n/a'],
  ['Gold kicker on card', 'gold', 'surface', 4.5, 'Modal kicker "STEP 1 OF 2", tour "STEP 1 OF 5" (12px)'],
  ['Gold kicker on gold card', 'gold', 'gold-soft', 4.5, 'Side card "TEAM PLAN", "CURRENT PLAN", desktop "SAVED BY CACHING" (11-12px)'],
  ['Gold initials on gold-soft', 'gold', 'gold-soft', 4.5, '.avatar-gold initials (12px 800)'],
  ['Gold ink on gold-soft', 'gold-ink', 'gold-soft', 4.5, '.gold-card .label/.sub, .pill-gold'],
  ['Secondary text on gold banner', 'text2', 'gold-soft', 4.5, '.banner-gold'],
  ['OK pill / banner', 'ok-text', 'ok-bg', 4.5, '.pill-ok, .banner-ok'],
  ['Warn pill / banner', 'warn-text', 'warn-bg', 4.5, '.pill-warn, .banner-warn'],
  ['Error pill / banner', 'no-text', 'no-bg', 4.5, '.pill-no, .banner-no'],
  ['Toast', 'bg', 'text', 4.5, '.toast'],
  ['Tabs inactive', 'muted', 'inset', 4.5, '.tabs button'],
  ['Logo letter', '#FFFFFF', 'accent', 4.5, '.logo (large, 19px+ bold -> 3:1)'],
  // non-text (WCAG 1.4.11, 3:1)
  ['Chart series 1 (Claude Code) on card', 's1', 'surface', 3, 'bars, line, donut, meters'],
  ['Chart series 2 (Codex) on card', 's2', 'surface', 3, 'bars, donut, tool mix'],
  ['Budget pace line on card', 'gold', 'surface', 3, 'SpendLine dashed line'],
  ['Meter fill s1 on track', 's1', 'raised', 3, '.meter'],
  ['Meter fill amber on track', 'amber', 'raised', 3, '.meter >=80%'],
  ['Meter fill red on track', 'red', 'raised', 3, '.meter >=100%'],
  ['Meter track on card', 'raised', 'surface', 3, '.meter track (decorative unless value is read from it)'],
  ['"Not started" legend swatch', 'raised', 'surface', 3, 'Overview Budget health legend'],
  ['Sessions split 4th segment', 'border-strong', 'surface', 3, 'Sessions "Where the tokens went" (SPLIT[3])'],
  ['Heatmap level 1 on card', 'heat1', 'surface', 3, '.heat .c'],
  ['Heatmap level 2 on card', 'heat2', 'surface', 3, '.heat .c'],
  ['Heatmap level 4 on card', 'heat4', 'surface', 3, '.heat .c'],
  ['Input border on inset', 'border-strong', 'inset', 3, '.input'],
  ['Input border on card', 'border-strong', 'surface', 3, '.input inside cards'],
  ['Search input border', 'border', 'inset', 3, '.search input (border-color: var(--border))'],
  ['Card / icon-btn border on page', 'border', 'bg', 3, '.icon-btn border (button boundary)'],
  ['Focus ring on page', 'accent-ink', 'bg', 3, ':focus-visible outline'],
  ['Focus ring on card', 'accent-ink', 'surface', 3, ':focus-visible outline'],
  ['OTP focus border on inset', 'accent', 'inset', 3, '.otp input:focus (outline: none)'],
  ['OTP focus vs unfocused border', 'accent', 'border-strong', 3, '.otp focus state change'],
  ['Unchecked checklist dot on inset', 'raised', 'inset', 3, '.dot-ok'],
  ['Tour target ring', 'accent', 'bg', 3, '.tour-target box-shadow'],
];
const LPAIRS = [
  ['Landing CTA sub text', 'cta-sub', 'brand', 4.5, 'landing final CTA "Start free with three members…" (18px)'],
  ['Landing announcement text', 'accent-ink', 'accent-soft', 4.5, 'top bar'],
  ['Landing "NEW" badge', '#FFFFFF', 'brand', 4.5, 'top bar badge (12px)'],
  ['Landing muted on surface', 'muted', 'surface', 4.5, 'pricing notes'],
  ['Landing panel-sub on panel', 'panel-sub', 'panel', 4.5, 'header/footer'],
  ['Landing CTA button', 'on-brand', 'cta-btn', 4.5, 'CTA button'],
];

function resolve(set, v, theme) { return v.startsWith('#') || v.startsWith('rgb') ? v : set[theme][v]; }
const out = [];
for (const theme of ['light', 'dark']) {
  for (const [set, pairs] of [[T, PAIRS], [L, LPAIRS]]) {
    for (const [label, f, b, need, where] of pairs) {
      const bgc = rgb(resolve(set, b, theme));
      const fgc = blend(rgb(resolve(set, f, theme)), bgc);
      const r = ratio(fgc, bgc);
      out.push({ theme, label, fg: `${f} ${hex(fgc)}`, bg: `${b} ${hex(bgc)}`, ratio: +r.toFixed(2), need, pass: r >= need, where });
    }
  }
}
fs.writeFileSync(path.join(here, 'contrast.json'), JSON.stringify(out, null, 2));
for (const o of out) console.log(`${o.pass ? 'ok  ' : 'FAIL'} ${o.theme.padEnd(5)} ${o.ratio.toFixed(2).padStart(5)} / ${o.need}  ${o.label}  [${o.fg} on ${o.bg}]`);
