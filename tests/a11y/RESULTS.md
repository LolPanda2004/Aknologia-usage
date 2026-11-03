## 5. Accessibility, visual quality and copy

QA subagent 5. Run on 2026-10-10 against the shared dev server (http://localhost:8080, DEV_MODE=true). No product code was changed.

### How to run

1. Start the server with DEV_MODE=true on :8080. Codes are read from `docker compose logs server`.
2. `cd tests/a11y` (`node_modules` here is a junction to `tests/e2e/node_modules`).
3. `npx playwright test -c playwright.a11y.config.ts` runs all three specs. Run one with `axe`, `keyboard` or `screens`.
4. `node contrast.mjs` prints the token contrast table and writes `contrast.json`.

The first run seeds an org and saves it to `tests/a11y/.seed.json`; later runs reuse it. The seed is admin `qa5-vryubm@example.test`, two active members with usage (Priya is over budget, Daniel is on track and has an old app version), and one pending invite.

| File | What it holds |
|---|---|
| `axe.a11y.spec.ts` → `axe-results.json` | axe on 18 views × 2 themes |
| `keyboard.a11y.spec.ts` → `keyboard-results.json` | keyboard and focus pass, plus a 390 px nav and overflow check |
| `screens.a11y.spec.ts` → `screenshots/*.png`, `layout-results.json` | 52 full-page screenshots (admin and public, both themes, 1440 and 390), footer and overflow checks |
| `contrast.mjs` → `contrast.json` | WCAG ratios for every token pair the UI uses |

### axe-core results (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa)

| Page | Light | Dark |
|---|---|---|
| Landing `/` | 0 | **1** (color-contrast, 1 node) |
| `/download/` | 0 | 0 |
| Admin: sign in, create workspace, accept invite, forgot password | 0 each | 0 each |
| Admin: overview, members, member detail, budgets, support, settings | 0 each | 0 each |
| Modals: invite (with a chip), remove, member budget, change plan, change password | 0 each | 0 each |
| Tour step 1 | 0 | 0 |
| Desktop window (subagent 4, `desktop-axe.md`): 9 views × 2 themes | 0 each | 0 each |

- **Total:** 1 violation, on the dark landing page.
- **Incomplete (axe could not decide):**
  - Auth pages (21 nodes each) and landing (16 nodes): the background is a gradient grid, so axe could not measure contrast. I checked these by hand from the tokens (contrast table below); they pass.
  - `aria-prohibited-attr`: `aria-label` on a plain `div` in `.checklist` and on the landing "Product facts" div (A11Y-14).

### Findings

| ID | Sev | Title | Repro / selector | Expected | Actual | Suspected cause | Suggested fix |
|---|---|---|---|---|---|---|---|
| A11Y-01 | **Major** | Modals don't move, trap or return focus | Members → focus "Invite members" → Enter. Then Tab. Same for Remove, Budget, Plan, Password and Server modals | Focus goes into the dialog, Tab stays inside it, and focus goes back to the trigger on close | Focus stays on the trigger. Tab goes through the whole page behind the overlay first (14+ stops) before reaching the dialog. After Esc or close, focus drops to `<body>` | `ui/shared/ui.tsx:131-151` (`Modal`): no initial focus, no trap, no restore | On mount, focus the first field or the close button. Trap Tab and Shift+Tab inside `.modal`. Save `document.activeElement` and restore it on unmount. Or use `<dialog>.showModal()` |
| A11Y-02 | **Major** | Tour can't be used by keyboard | First sign-in, or "?" → tour opens | Focus moves to the tour card, Esc closes it, page behind is inert | Focus stays on `<body>`. Esc does nothing. Skip/Next are 26 Tab stops away, after every control hidden behind the dimmer. `role=dialog` has no `aria-modal` and gets no focus | `ui/shared/ui.tsx:248-288` (`Tour`), card at `:273` | Focus Next on each step. Add an Esc handler that calls `finish`. Add `aria-modal="true"` and `aria-labelledby` pointing at the step title. Trap focus, or set `inert` on `.shell` |
| A11Y-03 | **Major** | Invite email input has no focus indicator | Invite modal → Tab to `#inv-emails` | A visible focus ring | Computed `outline: none`, no box-shadow, and the wrapper has no `:focus-within` style. Focus is invisible (WCAG 2.4.7) | `ui/admin/pages/Members.tsx:103-104` (inline `outline: 'none'`) | Remove `outline: none`, or add a `:focus-within` ring on the chip box (for example `outline: 2px solid var(--accent-ink)`) |
| A11Y-04 | **Major** | No navigation at phone width | Any signed-in admin page (and the desktop window) at 390 px | A menu button or bottom nav | `.side { display:none }` below 860 px and nothing replaces it: 0 nav buttons, no menu toggle. Users can only move between pages through in-page buttons. Support has no route at all | `ui/shared/theme.css:184`, `ui/shared/ui.tsx:301` | Add a hamburger in `.topbar` that opens the nav as a drawer (`aria-expanded`), or a bottom tab bar |
| A11Y-05 | Minor | Error banners not announced | Trigger an API error in the Invite, Remove or Security forms, or Support | Banner has `role="alert"`, as on the Auth pages | Plain `div.banner-no` with no role, so screen readers stay silent | `Members.tsx:17,98,127`; `Security.tsx:24`; `Support.tsx:38`; also `Budgets.tsx`, `Member.tsx`, `Overview.tsx` error returns | Add `role="alert"` to every `banner-no` that shows `err` |
| A11Y-06 | Minor | Several errors appear only in a 3.5 s toast | Save budgets, Settings save, member budget modal and invite results all call `ctx.toast(e.message)` | The error stays until dismissed, next to the control | The toast disappears after 3.5 s with no way to pause it (WCAG 2.2.1). Long "Skipped: …" lists are cut short | `ui/shared/ui.tsx:153`; `Members.tsx:91-92`, `:145` | Show errors inline with `role=alert`. Keep toasts for success, or let them stay while hovered or focused and add a close button |
| A11Y-07 | Minor | Focus lost on auth step changes | Forgot password → "Email me a code". Also sign in → overview | Focus moves to the new step's heading or first OTP box | `document.activeElement` is `<body>`. The step change is not announced | `ui/admin/pages/Auth.tsx` (`go()`), `ui/desktop/pages/Auth.tsx` | On step change, focus the `h2` (`tabIndex=-1`) or the first input |
| A11Y-08 | Minor | OTP box can't be overwritten; focus ring is weak | Type `9` in digit 1, focus digit 1 again, type `8` | The value becomes 8 | It stays 9 (`maxLength=1` and the text is not selected). Focus is shown only by a border-colour change (`outline:none`): 1.92:1 against the unfocused border in dark | `ui/shared/ui.tsx:85-109`; `theme.css:98` | `onFocus={e => e.target.select()}`. Keep an outline on `.otp input:focus-visible`. Typing, paste into any box (spaces stripped, 6 boxes filled), Backspace to the previous box and Enter-to-submit all work |
| A11Y-09 | Minor | Form control borders below 3:1 (WCAG 1.4.11) | Any `.input`, `.search input`, `.icon-btn` | Boundary ≥ 3:1 against its background | `--border-strong` on inset: 1.49 (light) and 1.90 (dark). Search and icon buttons use `--border`: 1.18 and 1.37 | `ui/shared/theme.css:5,19,88,131,56` | Darken `--border-strong`: light around `#8AA196` (≥3:1 on `#F4F7F5`), dark around `#4F7466` |
| A11Y-10 | Minor | Charts carry data by colour only, with no text alternative | Heatmap, "Not started" swatch, Sessions "Where the tokens went", Daily spend / Daily active bars | Marks ≥ 3:1 and data available as text | Heat levels 1-2 are 1.3-2.8:1 against the card. "Not started" swatch (`--raised`) is 1.16-1.18:1. Cache-read segment (`--border-strong`) is 1.6-1.8:1. Input and Output segments look the same in light (`#0A5139` vs `#0E6B4E`). Bars expose values only via `title`. The heatmap `role=img` label has no data | `ui/shared/ui.tsx:165-216`; `ui/desktop/pages/Sessions.tsx:8`; `Overview.tsx:82` | Use stronger heat steps or add a legend with values. Give the swatch a border. Give each bar an `aria-label` (or add an sr-only table). Make the SPLIT colours distinct |
| A11Y-11 | Minor | Landing CTA subtext fails contrast in dark | `/` dark, final CTA "Start free with three members…" | ≥ 4.5:1 | 3.99:1 (`#CDEBDF` on `#1E7D5E`, 18 px regular) | `landing/index.html:11` (`--cta-sub`), used at line 20 | Dark `--cta-sub: #FFFFFF` (5.06:1), or darken the CTA panel to `#0E5A43` |
| A11Y-12 | Minor | Sign-in header overflows at 390 px | `/app/#/` (and desktop auth) at 390 px | Header links and theme toggle fit or wrap | Right group spans 48-461 px and is clipped by `.auth {overflow:hidden}`: "aknologia.com" is cut and the **theme toggle is off-screen** | `ui/shared/theme.css:169` (`.auth-head`), `ui/shared/ui.tsx:364-369` | Let the right group wrap (`flex-wrap`), or hide the Pricing / Demo / site links under 480 px |
| A11Y-13 | Minor | Budgets page scrolls sideways at 390 px | `/app/#/budgets` at 390 px with an alert in the log | No horizontal scroll | `scrollWidth` is 423. Alert log rows use `150px minmax(0,1fr) minmax(0,1fr)` and the long "Emailed qa5-…@example.test" spills out of the card | `ui/admin/pages/Budgets.tsx:86` | Add `overflow-wrap:anywhere` on the email span, or stack the grid under 520 px. All other pages: no overflow at 390 |
| A11Y-14 | Minor | `aria-label` on role-less divs | `.checklist`; landing `div[aria-label="Product facts"]` | The label is exposed | Screen readers ignore it (axe `aria-prohibited-attr`). The checklist also doesn't say which rules are met (the icon is identical, only the colour changes) | `ui/shared/ui.tsx:72-79`; `landing/index.html:20` | Use `role="list"` / `role="listitem"`, add sr-only "met" / "not met" text per rule, and `aria-live="polite"` |
| A11Y-15 | Minor | Fake controls in the top bar | Search input + "⌘K", bell button (admin and desktop) | They work, or they aren't there | Search does nothing and ⌘K isn't bound. The bell does nothing. Screen readers announce working controls | `ui/shared/ui.tsx:317-318` | Remove them until built, or wire them up |
| A11Y-16 | Minor | Tabs and radio cards lack arrow-key support | Auth `role=tablist`, Support `role=radiogroup` | Arrow keys move between options; one Tab stop | Each option is its own Tab stop. Arrow keys do nothing. Tabs have no `aria-controls` / `tabpanel` | `ui/shared/ui.tsx:386-393`; `ui/shared/Support.tsx:39-46` | Add roving tabindex and arrow handlers, or drop the ARIA roles and use plain buttons with `aria-pressed` |
| A11Y-17 | Minor | No skip link | Tab once after sign-in | "Skip to content" | The first stop is the brand link, then 5 nav items and 6 top-bar controls before the page (landmarks exist, so axe `bypass` passes) | `ui/shared/ui.tsx:299` | Add `<a class="sr-only-focusable" href="#main">` and `id="main"` on `.content` |
| A11Y-18 | Minor | Settings section chips: first one always looks selected | `/app/#/settings` chips; desktop Settings | Show the current section, or style all chips the same | "Account and security" is always `btn-primary`. The others are `href="#/settings"` with `preventDefault`, so they are links acting as buttons | `ui/admin/pages/Settings.tsx:28`; `ui/desktop/pages/Settings.tsx:18` | Same style for all, or track the section in view. Use `<button>` |
| A11Y-19 | Note | Auth step ignores hash changes | On `#/accept`, set the hash to `#/` | The sign-in form | It stays on Accept invite. Browser Back doesn't change the auth step | `ui/admin/main.tsx:58`, `Auth.tsx` `useState(initial)` | Derive the step from the route, or key `<Auth>` by path |

### Contrast (WCAG 2.2 AA, computed from `ui/shared/theme.css` and landing tokens)

All text pairs pass in both themes: body, `text2`, `muted` on bg / surface / inset / raised / gold-soft, links, primary and danger buttons, pills, banners, gold kickers (light worst case 4.81:1), toast, tabs. Failures:

| Pair (where) | Light | Dark | Need |
|---|---|---|---|
| Landing CTA sub `--cta-sub` on `--brand` | 5.14 ok | **3.99** (`#CDEBDF`/`#1E7D5E`) | 4.5 |
| Input border `--border-strong` on inset (`.input`) | **1.49** (`#BFD0C6`/`#F4F7F5`) | **1.90** (`#2C4A3E`/`#0B1612`) | 3 |
| Input border on card | **1.61** | **1.80** | 3 |
| Search input / icon-btn border `--border` | **1.18** | **1.37 / 1.42** | 3 |
| OTP focus border vs unfocused (`--accent` vs `--border-strong`) | 4.04 ok | **1.92** | 3 |
| "Not started" swatch / meter track `--raised` on card | **1.18** | **1.16** | 3 |
| Heatmap level 1 / level 2 on card | **1.34 / 1.98** | **1.57 / 2.79** | 3 |
| Sessions cache-read segment `--border-strong` | **1.61** | **1.80** | 3 |
| Unchecked checklist dot `--raised` on inset | **1.09** | **1.23** | 3 |

Chart series pass: s1 6.50 / 6.83, s2 3.22 (light, tight) / 8.97, pace line 5.36 / 8.75, meter fills on track 4.19-7.12. Focus ring `--accent-ink` passes at 8.66-12.64.

### Keyboard results

| Flow | Result |
|---|---|
| Sign in | Pass. Logical tab order (brand → header links → theme → tabs → email → password → show password → forgot → invite → footer). Ring visible on every stop (2 px `#9FE0C6` in dark). Sign in with Enter works. Focus drops to body after sign-in (A11Y-07). No skip link (A11Y-17) |
| Invite modal | Opens with Enter and Esc closes it. Focus isn't moved, trapped or restored (A11Y-01). Email field ring invisible (A11Y-03). Comma or Enter makes a chip, and the chip's "Remove x" button is reachable by Shift+Tab |
| Remove modal | Opens with Enter and Esc closes it. Space toggles "Also delete history". Same focus problems (A11Y-01) |
| OTP | Typing advances. Letters are rejected. Backspace on an empty box goes back and deletes. Paste of "65 43 21" into box 3 fills all six. Pasting the real code and pressing Enter reaches "Choose a new password". Can't overwrite a filled box; focus ring weak (A11Y-08) |
| Tour | Fails (A11Y-02): no focus, Esc ignored, 26 Tabs to reach the buttons. Enter on Next steps through all 5 steps and then closes |
| Traps | None found. The opposite problem: modals don't contain focus |

### Visual review

Reviewed my 52 screenshots (`tests/a11y/screenshots/`: admin and public, light/dark, 1440/390), subagent 3's light-1440 admin flow shots, and subagent 4's desktop shots (`tests/e2e/screenshots/member/`).

- **Footer:** "© 2026 Aknologia. All rights reserved." is on every admin, landing, download and desktop page checked.
  - The desktop "Connecting to the agent" screen has no footer (`ui/desktop/main.tsx:55-62`). Minor.
  - `/download/` shows the © line as a plain `<small>`, not a `<footer>` landmark. Note.
- **Layout at 390 px:**
  - No horizontal scroll except Budgets (A11Y-13).
  - Auth header is clipped (A11Y-12).
  - There is no navigation (A11Y-04).
  - Tables scroll inside their own wrappers. At 390 px the Members and Overview tables show only 2 columns and clip the status pills ("Over budg…") at the scroll edge. Acceptable, but cards would read better. Note.
- **Overview, Data health:** the status dot wraps onto its own line above the text in 2 of 3 rows. Only the "old app version" row is aligned (`ui/admin/pages/Overview.tsx:132-134`; the span has no `flex: 1`). Minor.
- **Desktop Sessions:**
  - The session list has no column headers for the three number columns (time, tokens, cost) (`ui/desktop/pages/Sessions.tsx:38-41`). Minor.
  - The toast sits over the "What drove the cost" card for 3.5 s. Note.
- **Desktop and admin at 1440:** no overlap, clipping or misaligned cards seen. Spacing is consistent.

### Copy review

- **No placeholder text.** No lorem ipsum, TODO or FIXME in `ui/` or `landing/`.
- **Sentence case is used throughout.** Uppercase kickers ("STEP 1 OF 5", "TEAM PLAN", "WORKSPACE", "SECURE SIGN-IN") are written in caps in the source rather than with CSS `text-transform`, so some screen readers may spell them out. Note: use `text-transform: uppercase`.
- **Plurals:**
  - "1 devices on an old app version" (`Overview.tsx:133`).
  - "3 lines unread on 1 device(s)" (`Overview.tsx:134`).
  - Invite button reads "Send 1 invites" when only typed text is present (`Members.tsx:112`: the plural tests `emails.length` but the count uses `draft`). Minor.
- **Raw codes shown to users:** invite results show "belongs to another org", "email failed" and "error" (`Members.tsx:91`, from `admin_handlers.go:358-374`). Map them to sentences, for example "already in another workspace", "we couldn't send the email; try Resend". Minor.
- **Terms:**
  - The admin action is called "Refresh data" (top bar and tour), "Refresh from database" / "Refresh now" (Settings → Data). Pick one label. Minor.
  - Landing FAQ says developers "set a password from the invite link", but the app and download page say "invite code". Minor.
  - "Force sync", "budget" and "invite code" are otherwise consistent. `Support.tsx` quick-help "What force sync does" should capitalise it as "Force sync". Note.
- **Inconsistent decimals:** "Spend by model" shows "76%" next to "15.2%" / "8.8%". Note.
- **Member devices column** shows the OS ("darwin", "windows") instead of the device name (`Members.tsx:53`, `m.devices`). Note.
- **Backend errors** mostly say what happened and what to do (good). Vague ones:
  - "Check the values and try again." (`admin_handlers.go:660`)
  - "Check the form and try again." (`auth_handlers.go:166`)
  - "Unknown time zone." (`admin_handlers.go:721`)
  - "Malformed batch." (`ingest.go:77`, agent-only)

  Name the field or the fix, for example "Choose a time zone from the list."
- **`/download/` installer links return 404** (`aknologia-usage-windows.zip` etc. are not in the dev build). Probably expected locally. Not verified in production.

### Not verified

- **Real screen readers** (NVDA, VoiceOver): not run. Findings come from DOM, ARIA and focus inspection.
- **Desktop window keyboard pass:** not run by me (port 47811 / 5174 belong to subagent 4). Its modals and tour use the same shared `Modal` / `Tour`, so A11Y-01 and A11Y-02 apply. Desktop axe is from subagent 4.
- **Desktop window copy and contrast:** reviewed from source and subagent 4's screenshots only. The unpaired / removed / budget-reached states were reviewed from source and the screenshots present.
- **Dark-mode screenshots of every admin modal at 390:** captured (invite, remove, tour). The plan, password and data-delete modals were scanned with axe but not screenshotted.
- **Windows High Contrast / forced-colors, 200% zoom and 320 px reflow:** not tested.
- **Admin data with more members** (long names in fixed 140 px columns, for example `Overview.tsx:91`): only seen with 4 members.
