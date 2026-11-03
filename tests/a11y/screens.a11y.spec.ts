// Full-page screenshots of admin + public pages (both themes, 1440 and 390) into tests/a11y/screenshots,
// plus layout checks: footer text, horizontal overflow, elements sticking out of the viewport, clipped text.
import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { OUT, seed, type Seed } from './helpers';

let S: Seed;
const res: any[] = [];
const DIR = path.join(OUT, 'screenshots');
test.beforeAll(async () => { S = await seed(); fs.mkdirSync(DIR, { recursive: true }); });
test.afterAll(() => {
  const f = path.join(OUT, 'layout-results.json');
  const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  fs.writeFileSync(f, JSON.stringify([...prev.filter((p: any) => !res.some((r) => r.name === p.name)), ...res], null, 2));
});

async function check(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const clipped: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.closest('.table-wrap, .auth-rings, .chip, svg')) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
      if (r.right > vw + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} "${(el.innerText || '').slice(0, 30)}" [${Math.round(r.left)}..${Math.round(r.right)}]`);
      if ((cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden') && el.scrollWidth > el.clientWidth + 1 && el.innerText) clipped.push(`${el.tagName.toLowerCase()} "${el.innerText.slice(0, 40)}"`);
    }
    const foot = Array.from(document.querySelectorAll('footer, small, span')).map((e) => (e as HTMLElement).innerText).find((t) => /©\s*\d{4}\s+Aknologia\. All rights reserved\./.test(t || ''));
    return { scrollW: document.documentElement.scrollWidth, vw, outOfViewport: out.slice(0, 12), clipped: clipped.slice(0, 12), footer: foot ?? null, h1: Array.from(document.querySelectorAll('h1')).map((h) => h.textContent) };
  });
  await page.screenshot({ path: path.join(DIR, `${name}.png`), fullPage: true });
  res.push({ name, ...info });
}

for (const theme of ['light', 'dark'] as const) {
  for (const w of [1440, 390]) {
    test(`screens ${theme} ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(([t, tok]) => {
        localStorage.setItem('akn-theme', t);
        if (!sessionStorage.getItem('qa-tour')) localStorage.setItem('akn-admin-toured', '1');
        if (sessionStorage.getItem('qa-signed')) localStorage.setItem('akn-admin-token', tok); else localStorage.removeItem('akn-admin-token');
      }, [theme, S.token]);
      const tag = `${theme}-${w}`;
      await page.goto('/'); await check(page, `landing-${tag}`);
      await page.goto('/download/'); await check(page, `download-${tag}`);
      await page.goto('/app/#/'); await check(page, `admin-signin-${tag}`);
      await page.goto('/app/#/signup'); await page.reload(); await check(page, `admin-signup-${tag}`);
      // signed in
      await page.evaluate(() => sessionStorage.setItem('qa-signed', '1'));
      const id = S.memberIds[S.members[0]];
      for (const [h, n] of [['#/', 'overview'], ['#/members', 'members'], [`#/members/${id}`, 'member-detail'], ['#/budgets', 'budgets'], ['#/support', 'support'], ['#/settings', 'settings']]) {
        await page.goto('/app/' + h); await page.reload(); await page.waitForSelector('h1'); await check(page, `admin-${n}-${tag}`);
      }
      await page.goto('/app/#/members'); await page.reload(); await page.waitForSelector('h1');
      await page.getByRole('button', { name: 'Invite members' }).first().click();
      await page.locator('#inv-emails').fill('one@example.test two@example.test'); await page.keyboard.press('Enter');
      await check(page, `admin-modal-invite-${tag}`);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Remove', exact: true }).first().click();
      await check(page, `admin-modal-remove-${tag}`);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { sessionStorage.setItem('qa-tour', '1'); localStorage.removeItem('akn-admin-toured'); });
      await page.goto('/app/#/'); await page.reload(); await page.waitForSelector('.tour-card', { timeout: 10000 }); await page.waitForTimeout(700);
      await check(page, `admin-tour-${tag}`);
    });
  }
}
