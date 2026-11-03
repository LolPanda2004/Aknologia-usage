// Keyboard-only pass: sign in, invite / remove modals, OTP inputs, tour. Writes tests/a11y/keyboard-results.json.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { OUT, api, codeFor, seed, type Seed } from './helpers';

let S: Seed;
const log: Record<string, any> = {};
test.beforeAll(async () => { S = await seed(); });
test.afterAll(() => {
  const f = path.join(OUT, 'keyboard-results.json');
  const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  fs.writeFileSync(f, JSON.stringify({ ...prev, ...log }, null, 2));
});

async function prep(page: Page, signedIn: boolean, toured = true) {
  await page.addInitScript(([tok, tour]) => {
    localStorage.setItem('akn-theme', 'dark');
    if (tour) localStorage.setItem('akn-admin-toured', '1'); else localStorage.removeItem('akn-admin-toured');
    if (tok) localStorage.setItem('akn-admin-token', tok as string); else localStorage.removeItem('akn-admin-token');
  }, [signedIn ? S.token : '', toured] as const);
}

/** Describes the focused element and whether a visible focus indicator is drawn. */
const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return { el: 'body', visible: false, inDialog: false };
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const name = el.getAttribute('aria-label') || (el as any).labels?.[0]?.textContent || el.textContent?.trim().slice(0, 40) || (el as HTMLInputElement).placeholder || '';
  return {
    el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''} "${name}"`,
    visible: outline || cs.boxShadow !== 'none',
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    border: cs.borderColor,
    inDialog: !!el.closest('[role=dialog],[role=alertdialog]'),
  };
});

async function tabWalk(page: Page, n: number, key = 'Tab') {
  const seen: any[] = [];
  for (let i = 0; i < n; i++) { await page.keyboard.press(key); seen.push(await focused(page)); }
  return seen;
}

test('sign-in by keyboard', async ({ page }) => {
  await prep(page, false);
  await page.goto('/app/#/');
  await page.waitForSelector('#si-email');
  const walk = await tabWalk(page, 16);
  log.signinTabOrder = walk;
  // sign in purely by keyboard
  await page.locator('#si-email').focus();
  await page.keyboard.type(S.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(S.password);
  await page.keyboard.press('Enter');
  await page.waitForSelector('h1', { timeout: 15000 });
  log.signinResult = await page.locator('h1').innerText();
  log.signinFocusAfter = await focused(page);
  // skip link?
  await page.keyboard.press('Tab');
  log.firstTabAfterSignin = await focused(page);
  log.skipLink = await page.locator('a[href^="#main"], a:has-text("Skip")').count();
});

test('invite modal by keyboard', async ({ page }) => {
  await prep(page, true);
  await page.goto('/app/#/members');
  await page.waitForSelector('h1');
  const btn = page.getByRole('button', { name: 'Invite members' }).first();
  await btn.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=dialog]');
  log.inviteFocusOnOpen = await focused(page);
  const walk = await tabWalk(page, 14);
  log.inviteTabWalk = walk;
  log.inviteFocusEscapesDialog = walk.some((w) => !w.inDialog);
  // email field focus indicator
  await page.locator('#inv-emails').focus();
  log.inviteEmailFocus = await focused(page);
  await page.keyboard.type('a.person@example.test,');
  log.inviteChipCount = await page.locator('[role=dialog] .pill').count();
  // remove chip by keyboard: is the chip's remove button reachable?
  await page.keyboard.press('Shift+Tab');
  log.inviteShiftTabFromInput = await focused(page);
  await page.keyboard.press('Escape');
  log.inviteClosedByEscape = (await page.locator('[role=dialog]').count()) === 0;
  log.inviteFocusAfterClose = await focused(page);
  // background still tabbable while modal open?
  await btn.focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  log.inviteShiftTabFromOpen = await focused(page);
  await page.keyboard.press('Escape');
});

test('remove modal by keyboard', async ({ page }) => {
  await prep(page, true);
  await page.goto('/app/#/members');
  await page.waitForSelector('h1');
  const btn = page.getByRole('button', { name: 'Remove', exact: true }).first();
  await btn.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=alertdialog]');
  log.removeFocusOnOpen = await focused(page);
  const walk = await tabWalk(page, 8);
  log.removeTabWalk = walk;
  log.removeFocusEscapesDialog = walk.some((w) => !w.inDialog);
  // checkbox toggle by Space
  await page.locator('[role=alertdialog] input[type=checkbox]').focus();
  await page.keyboard.press('Space');
  log.removeCheckboxSpace = await page.locator('[role=alertdialog] input[type=checkbox]').isChecked();
  log.removeCheckboxFocus = await focused(page);
  await page.keyboard.press('Escape');
  log.removeClosedByEscape = (await page.locator('[role=alertdialog]').count()) === 0;
  log.removeFocusAfterClose = await focused(page);
});

test('OTP inputs: typing, paste, backspace, real code', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await prep(page, false);
  await page.goto('/app/#/');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.locator('#fp-email').fill(S.email);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.otp input');
  const d = page.locator('.otp input');
  log.otpFocusOnStep = await focused(page);
  await d.nth(0).focus();
  log.otpFocusStyle = await focused(page);
  await page.keyboard.type('123');
  log.otpAfterType123 = { values: await d.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join('|')), focus: await focused(page) };
  await page.keyboard.press('Backspace');
  log.otpAfterBackspace1 = { values: await d.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join('|')), focus: await focused(page) };
  await page.keyboard.press('Backspace');
  log.otpAfterBackspace2 = { values: await d.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join('|')), focus: await focused(page) };
  await page.keyboard.press('Backspace');
  log.otpAfterBackspace3 = { values: await d.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join('|')), focus: await focused(page) };
  await page.keyboard.press('ArrowLeft');
  log.otpArrowLeft = await focused(page);
  // type a letter: rejected?
  await d.nth(0).focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  await page.keyboard.type('x');
  log.otpLetter = await d.nth(0).inputValue();
  // overwrite a filled box
  await d.nth(0).focus(); await page.keyboard.type('9');
  await d.nth(0).focus(); await page.keyboard.type('8');
  log.otpOverwriteFirst = { values: await d.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join('|')), focus: await focused(page) };
  // paste into box 3 (index 2)
  for (let i = 5; i >= 0; i--) { await d.nth(i).fill(''); }
  await page.evaluate(() => navigator.clipboard.writeText('65 43 21'));
  await d.nth(2).focus();
  await page.keyboard.press('Control+v');
  log.otpPasteInto3rd = { values: await d.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join('|')), focus: await focused(page) };
  // real code: paste into first and submit with Enter
  const code = await codeFor(S.email, 'reset');
  await page.evaluate((c) => navigator.clipboard.writeText(c), code);
  await d.nth(0).focus();
  await page.keyboard.press('Control+v');
  log.otpPasteReal = { values: await d.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join('|')), focus: await focused(page) };
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  log.otpSubmitResult = await page.locator('.auth-card h2').innerText();
  log.otpError = await page.locator('[role=alert]').allInnerTexts();
});

test('tour by keyboard', async ({ page }) => {
  await prep(page, true, false);
  await page.goto('/app/#/');
  await page.waitForSelector('.tour-card', { timeout: 10000 });
  await page.waitForTimeout(500);
  log.tourFocusOnOpen = await focused(page);
  await page.keyboard.press('Escape');
  log.tourClosedByEscape = (await page.locator('.tour-card').count()) === 0;
  // count Tabs needed to reach the tour Next button
  let n = 0; let reached = false;
  for (; n < 80; n++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (/Next|Skip/.test(f.el)) { reached = true; break; }
  }
  log.tourTabsToReachButtons = reached ? n + 1 : 'not reached in 80';
  log.tourBackgroundFocusable = await page.evaluate(() => !!document.activeElement && !document.activeElement.closest('.tour-card'));
  if (reached) {
    // step through with Enter
    const steps: string[] = [];
    for (let i = 0; i < 6; i++) {
      const t = await page.locator('.tour-card').count() ? await page.locator('.tour-card span').first().innerText() : 'closed';
      steps.push(t);
      const f = await focused(page);
      if (!/Next|Done/.test(f.el)) { await page.locator('.tour-card .btn-primary').focus().catch(() => {}); }
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(450);
    }
    log.tourSteps = steps;
    log.tourFocusAfterNext = await focused(page);
  }
});

test('mobile 390 navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prep(page, true);
  await page.goto('/app/#/');
  await page.waitForSelector('h1');
  log.mobileNavVisible = await page.locator('nav[aria-label=Main]').isVisible();
  log.mobileNavButtons = await page.locator('button.nav-item:visible').count();
  log.mobileMenuToggle = await page.locator('button[aria-label*="menu" i]').count();
  log.mobileHScroll = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
  for (const h of ['#/members', '#/budgets', '#/settings', '#/support']) {
    await page.goto('/app/' + h); await page.waitForSelector('h1'); await page.waitForLoadState('networkidle');
    log['mobileHScroll ' + h] = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
  }
  await page.addInitScript(() => localStorage.removeItem('akn-admin-token'));
  for (const u of ['/', '/download/']) {
    await page.goto(u); await page.waitForLoadState('networkidle');
    log['mobileHScroll ' + u] = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
  }
  expect(true).toBe(true);
});
