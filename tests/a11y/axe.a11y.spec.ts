// axe-core scan of every admin page, landing and /download/, both themes, plus open modals and the tour.
import { test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { OUT, seed, type Seed } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
type Row = { page: string; theme: string; url: string; violations: any[]; passes: number; incomplete: any[] };
const rows: Row[] = [];
let S: Seed;

async function prep(page: Page, theme: string, signedIn: boolean, toured = true) {
  await page.emulateMedia({ colorScheme: theme as any });
  await page.addInitScript(([t, tok, tour]) => {
    localStorage.setItem('akn-theme', t as string);
    if (tour) localStorage.setItem('akn-admin-toured', '1'); else localStorage.removeItem('akn-admin-toured');
    if (tok) localStorage.setItem('akn-admin-token', tok as string); else localStorage.removeItem('akn-admin-token');
  }, [theme, signedIn ? S.token : '', toured] as const);
}

async function scan(page: Page, name: string, theme: string, include?: string) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(400);
  let b = new AxeBuilder({ page }).withTags(TAGS);
  if (include) b = b.include(include);
  const r = await b.analyze();
  rows.push({
    page: name, theme, url: page.url(), passes: r.passes.length,
    incomplete: r.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length, detail: v.nodes.map((n) => ({ target: n.target.join(" "), summary: n.failureSummary })) })),
    violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags.filter((t) => t.startsWith('wcag')), nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: n.failureSummary, html: n.html.slice(0, 200) })) })),
  });
}

test.beforeAll(async () => { S = await seed(); });
test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, 'axe-results.json'), JSON.stringify(rows, null, 2));
});

for (const theme of ['light', 'dark']) {
  test(`public pages ${theme}`, async ({ page }) => {
    await prep(page, theme, false);
    await page.goto('/'); await scan(page, 'landing /', theme);
    await page.goto('/download/'); await scan(page, 'download /download/', theme);
    for (const [hash, name] of [['#/', 'admin sign in'], ['#/signup', 'admin create workspace'], ['#/accept', 'admin accept invite']]) {
      await page.goto('/app/' + hash); await page.reload(); await scan(page, name, theme);
    }
    await page.goto('/app/#/'); await page.reload(); await page.getByRole('button', { name: 'Forgot password?' }).click(); await scan(page, 'admin forgot password', theme);
  });

  test(`signed-in pages ${theme}`, async ({ page }) => {
    await prep(page, theme, true);
    const id = S.memberIds[S.members[0]];
    for (const [hash, name] of [['#/', 'admin overview'], ['#/members', 'admin members'], [`#/members/${id}`, 'admin member detail'], ['#/budgets', 'admin budgets'], ['#/support', 'admin support'], ['#/settings', 'admin settings']]) {
      await page.goto('/app/' + hash); await page.waitForSelector('h1'); await scan(page, name, theme);
    }
    // modals
    await page.goto('/app/#/members'); await page.getByRole('button', { name: 'Invite members' }).first().click();
    await page.locator('#inv-emails').fill('new.person@example.test'); await page.keyboard.press('Enter');
    await scan(page, 'modal: invite members', theme);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Remove', exact: true }).first().click(); await scan(page, 'modal: remove member', theme);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Edit budget' }).first().click(); await scan(page, 'modal: member budget', theme);
    await page.keyboard.press('Escape');
    await page.goto('/app/#/settings'); await page.getByRole('button', { name: 'Change plan or seats' }).click(); await scan(page, 'modal: change plan', theme);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Change password' }).click(); await scan(page, 'modal: change password', theme);
    await page.keyboard.press('Escape');
  });

  test(`tour ${theme}`, async ({ page }) => {
    await prep(page, theme, true, false);
    await page.goto('/app/#/');
    await page.waitForSelector('.tour-card', { timeout: 10000 });
    await page.waitForTimeout(600);
    await scan(page, 'tour step 1', theme);
  });
}
