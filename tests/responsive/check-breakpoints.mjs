// Breakpoint guard: every width in an @media rule must be one of the four breakpoints in ui/shared/breakpoints.ts
// (min-width: 480/768/1024/1280, max-width: the same minus 0.02). Exit 1 on any other value.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bp = fs.readFileSync(path.join(root, 'ui/shared/breakpoints.ts'), 'utf8');
const nums = Object.values(JSON.parse('{' + /BP = \{([^}]*)\}/.exec(bp)[1].replace(/(\w+):/g, '"$1":') + '}'));
const ok = new Set(nums.flatMap((n) => [`min-width: ${n}px`, `max-width: ${n - 0.02}px`]));
let bad = 0, total = 0;
for (const f of ['ui/shared/theme.css', 'landing/index.html', 'landing/download/index.html']) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of s.matchAll(/@media[^{]*\{/g)) {
    for (const w of m[0].matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)) {
      total++;
      const k = `${w[1]}-width: ${w[2]}px`;
      if (!ok.has(k)) { bad++; console.log(`BAD ${f}: ${m[0].trim()}`); }
    }
  }
}
console.log(`breakpoints: ${total} width queries checked against ${nums.join('/')}, ${bad} bad`);
process.exitCode = bad ? 1 : 0;
