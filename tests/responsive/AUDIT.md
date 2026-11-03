# Responsive audit — before

Date 2026-10-10 · Chromium (Playwright 1.64) · server :8080 (DEV_MODE) · desktop window via Vite :5174 + sandboxed agent.
No product code was changed.

## Scope and method

- **800 page states** = 32 web states (landing, /download/, 7 admin auth screens, 6 admin pages with data, 5 empty-state
  pages, 7 modals, 5 tour steps) × 7 widths × 2 themes, plus 22 desktop-window states (unpaired, 6 auth screens, server
  modal, removed, 4 pages, 2 empty states, over-budget banner, 2 password-modal steps, 5 tour steps) × 8 sizes (the 7 widths
  + 960×640) × 2 themes.
- Widths/heights: 360×740, 390×844, 768×1024, 1024×768, 1280×800, 1440×900, 1920×1080, desktop 960×640. `hasTouch` on ≤ 768.
- Screenshots: `tests/responsive/screenshots/before/<page>-<width>-<theme>.png` (full page; modal and tour states are
  viewport shots because the overlay is fixed).
- Checks per state (`measure.ts`): horizontal page scroll, elements overflowing the parent's right edge (outermost
  offender only), elements pushed past the viewport, clipped text, scrolling tables, interactive targets < 44×44
  (≤ 768; inline links listed separately), input font-size < 16 px (≤ 768), dialogs/tour/toast outside the viewport or
  primary action covered, chart labels wider than their slot, sidebar hidden with no replacement, console errors.
- Fake API responses (Playwright `route`) were used only to reach screens without side effects: OTP/verify/new-password
  steps, delete-data and change-password step 2, desktop signed-out/removed states, desktop empty states and the
  over-budget banner. Nothing was written to the server except one new empty org (`.state.json`) and one desktop test org.
- Rerun: `cd tests/responsive && npx playwright test -c playwright.responsive.config.ts` then `node summarize.mjs before`
  (full tables: `results/before/summary.md`; raw data: `results/before/*.json`).
- axe baseline (wcag2a/2aa/21a/21aa/22aa) on every state at 390 and 1440, both themes: `axe-baseline.json`.

## Headline numbers

| Check | States affected (of 800) | Items |
|---|---:|---:|
| Sidebar hidden, no menu (< 860 px) | 222 | every signed-in admin/desktop state at 360/390/768 |
| Tap targets < 44×44 (≤ 768, non-inline) | 270 | 1278 |
| Input font-size < 16 px (≤ 768) | 264 | 588 |
| Tables that scroll sideways | 205 | — |
| Element pushed past the viewport (clipped) | 99 | 228 |
| Element overflowing its parent | 62 | 98 |
| Dialog / tour card off-screen or action covered | 16 | 20 |
| Horizontal page scroll | 16 | 16 |
| Clipped text (ellipsis) | 4 | 12 |
| Chart labels overlapping | 4 | 4 |
| Console errors | 1 | 1 (transient `ERR_EMPTY_RESPONSE` during one tour run at 1024; not reproducible) |

axe baseline: **216 scans, 22 violations** — `scrollable-region-focusable` (serious) on every scrolling table at 390
(admin member detail, desktop overview + its 5 tour steps + over-budget, landing comparison table), and the known
`color-contrast` on the dark landing CTA (A11Y-11) at 390 and 1440. Nothing else.

**Widths ≥ 1024 are almost clean**: the only issues there are tables that still scroll at 1024 and 1280 (Overview
members 900 px and Members 940 px tables are wider than the 1280 content column), the tour card covered by its target
at 960×640 (step 1, desktop), and the password modal running below a 640 px-tall window.

## Problem count per page and width

Max of both themes (light and dark give the same layout; only colour differs). Sum of: h-scroll + overflow + off-screen +
clipped + small targets + small input font + dialog + chart + hidden nav + console. Tables listed separately below.

| Page | 360 | 390 | 768 | 960×640 | 1024 | 1280 | 1440 | 1920 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| landing | 25 | 25 | 26 | – | 0 | 0 | 0 | 0 |
| download | 0 | 0 | 0 | – | 0 | 0 | 0 | 0 |
| admin-signin / signup / verify / accept / forgot / otp / newpw | 7 / 10 / 11 / 8 / 6 / 11 / 7 | same | 5 / 8 / 3 / 6 / 4 / 3 / 5 | – | 0 | 0 | 0 | 0 |
| admin-overview | 11 | 11 | 11 | – | 4 | 0 | 0 | 0 |
| admin-members | 19 | 19 | 19 | – | 0 | 0 | 0 | 0 |
| admin-member-detail | 16 | 16 | 5 | – | 0 | 0 | 0 | 0 |
| admin-budgets | 20 | 20 | 19 | – | 0 | 0 | 0 | 0 |
| admin-support | 9 | 9 | 9 | – | 0 | 0 | 0 | 0 |
| admin-settings | 10 | 10 | 10 | – | 0 | 0 | 0 | 0 |
| admin empty: overview / members / member / budgets / settings | 7 / 11 / 5 / 14 / 9 | same | same | – | 0 | 0 | 0 | 0 |
| modals: invite / remove / budget / plan / delete / password 1 / password 2 | 5 / 1 / 2 / 3 / 7 / 6 / 7 | 5 / 1 / 2 / 3 / 7 / 4 / 7 | 5 / 1 / 2 / 3 / 1 / 4 / 1 | – | 0 | 0 | 0 | 0 |
| admin tour 1–5 | 8 / 8 / 9 / 8 / 8 | same | 8 | – | 4 (table clip) | 0 | 0 | 0 |
| desk auth: signin / server modal / invite / forgot / otp / newpw / removed | 7 / 3 / 9 / 6 / 11 / 7 / 5 | same | 5 / 1 / 7 / 4 / 3 / 5 / 3 | 0 | 0 | 0 | 0 | 0 |
| desk-overview (+ empty, over-budget) | 8 | 8 | 8 | 0 | 0 | 0 | 0 | 0 |
| desk-sessions (+ empty 8) | 12 | 10 | 8 | 0 | 0 | 0 | 0 | 0 |
| desk-support | 9 | 9 | 9 | 0 | 0 | 0 | 0 | 0 |
| desk-settings | 13 | 13 | 12 | 0 | 0 | 0 | 0 | 0 |
| desk password modal 1 / 2 | 7 / 8 | 5 / 8 | 4 / 1 | 1 / 0 | 0 | 0 | 0 | 0 |
| desk tour 1–5 | 5 / 4 / 4 / 4 / 4 | same | 4 | 1 / 0 / 0 / 0 / 0 | 0 | 0 | 0 | 0 |
| desk-unpaired | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Problems found

Screenshot paths: replace `<w>`/`<theme>` in `tests/responsive/screenshots/before/<page>-<w>-<theme>.png`. Both themes
unless noted. "QA" = existing finding in `tests/REPORT.md`.

### R1. No navigation below 860 px (admin + desktop) — QA ADM-01 / A11Y-04 / MEM-11
- Pages: every signed-in page, 360/390/768, both themes (222 states). Selector `nav.side` (`display:none`, `theme.css:184`).
- Support and Settings are unreachable; Members/Budgets only via in-page buttons.
- Shot: `admin-overview-390-light.png`, `desk-overview-390-dark.png`.

### R2. Top bar takes ~215 px on phones
- Pages: all signed-in pages, 360/390. `.topbar` wraps into 3 rows: breadcrumb, `.search` (min-width 200), icon buttons,
  user block (name + "Admin · Sign out"). Search is non-functional (QA MEM-08).
- Shot: `admin-overview-360-light.png` (top of page), `desk-sessions-390-light.png`.

### R3. Auth header pushed off-screen; theme toggle unreachable — QA A11Y-12
- Pages: all admin and desktop auth screens (14 states each width), 360/390. Selector
  `#root > div.auth > header.auth-head > div` overflows its parent by +101 px, spans 48..461 px, clipped by
  `.auth { overflow:hidden }`; "aknologia.com" is cut and the theme toggle is not visible.
- Shot: `admin-signin-360-light.png`, `desk-signin-390-dark.png`.

### R4. Horizontal page scroll
| Page | Widths | Cause (selector) | Shot |
|---|---|---|---|
| admin-budgets | 360, 390 (408 / 423 px) | Alert-log row `main.content > section.card:nth-of-type(2) > div > span.text2` — "Emailed qa5-…@example.test" can't break inside the fixed `150px 1fr 1fr` grid; also the status dot shrinks to ~2 px (QA ADM-10 / A11Y-13) | `admin-budgets-390-light.png` |
| desk-settings (+ password modal 1/2 opened from it) | 360, 390 (485 px) | `#sync > section.card > div.between > span > span.mono.muted` — source path `C:\Users\…\aknologia` with no break opportunity (new) | `desk-settings-390-light.png` |

### R5. Tables unusable on small screens
| Table | Widths where it scrolls | Visible at 390 | Notes | Shot |
|---|---|---|---|---|
| Admin Overview → Members (`min-width:900`) | 360–1280 | 34 % | Status pills clipped ("Over budg…"); tool-mix bars clipped inside the scroll | `admin-overview-390-light.png` |
| Admin Members (`min-width:940`) | 360–1280 | ~32 % | Actions (Edit budget / Remove / Resend / Cancel) start ~600 px to the right | `admin-members-390-light.png` |
| Budgets → Member budgets (`min-width:860`) | 360–1024 | 35 % | Budget input and meter split by the scroll; input 100×40 | `admin-budgets-390-light.png` |
| Member detail → Recent sessions (`min-width:540`) | 360–390 and 1280 | ~56 % | axe `scrollable-region-focusable` | `admin-member-detail-390-light.png` |
| Desktop Overview → Recent sessions (`min-width:640`) | 360–1024, 960×640 | 48 % | axe `scrollable-region-focusable` | `desk-overview-390-light.png` |
| Settings → Invoices (`min-width:560`) | when invoices exist (none in seed) | — | code review: same pattern | — |
| Landing → Compare plans (`min-width:820`) | 360–768 | 39–42 % | axe serious; no sticky feature column | `landing-390-light.png` |
| Desktop Sessions list rows (grid `2fr 1fr 1fr 1fr`) | 360, 390 | — | Project names clipped by ellipsis ("billing-service", "web-dashboard"); number columns have no headers | `desk-sessions-360-light.png` |

### R6. Tap targets < 44×44 (≤ 768)
Most frequent at 390 (count of states):
- OTP boxes 39×62 at 390 (34×62 at 360): verify, otp, delete-data, password step 2, desktop otp (36 states).
- Footer links `footer.footer a` 42×20 / 36×20 / 82×20 on every app page (93 states) and landing footer links 66–93×32,
  bottom links 36–46×17.
- `btn-sm` 38 px tall: tour Skip/Next (`.tour-card .btn`), Members filters and row actions, Security "Remove"/"Sign out".
- Segmented `.seg button` 36 px tall (Overview month, desktop range, Appearance).
- In-table budget input `input.input.mono` 100×40 (Budgets).
- Member links `td > a` 225×39 (Members).
- Switch checkboxes 22×22 (`#r80`, `#r100`, `#rw`, `#rm`, `#pf-*`): the label next to them is the larger target
  (counted 259×23 because label and input are siblings). Inbox/invite chip "×" buttons 12×12 (code review; no chips in seed).
- Landing header: logo link 153×38, nav links 43 px tall.
Shot: `admin-members-390-light.png`, `admin-budgets-390-light.png`, `landing-390-light.png`.

### R7. Input font-size 15 px on phones (iOS zooms on focus)
- `.input` (15 px), `.search input`, `select.input`, `textarea.input`: 588 items in 264 states at ≤ 768, e.g. Budgets 7,
  Support 5, signup 5, desktop invite 4, landing demo form 5.

### R8. Modals and tour off-screen / blocked
| State | Widths | Problem | Shot |
|---|---|---|---|
| admin-tour-3 (KPIs) | 360, 390 | `.tour-card` Next covered by the highlighted KPI column (`div.row.tour-target[data-tour=kpis]`, z 62 > card 61) — QA ADM-02 | `admin-tour-3-390-light.png` |
| desk-tour-1 (KPIs) | 360, 390, 960×640 | same, desktop window step 1 (new at 960×640) | `desk-tour-1-960x640-dark.png` |
| admin-tour-5 | 360–768 | points at the hidden sidebar (0×0 target) — QA ADM-03 (visible in shots; my check doesn't flag missing targets) | `admin-tour-5-390-light.png` |
| modal-password-1 (admin + desktop) | 360, 960×640 | `.modal` bottom below the viewport (overlay `padding-top:120px`); Cancel/Continue need scrolling | `modal-password-1-360-light.png`, `desk-modal-password-1-960x640-light.png` |
| Modal header | 360 | title wraps and the close button drops to its own row (`.modal > .between`) | `modal-password-1-360-light.png` |
| Invite modal | 360, 390 | Role / Monthly budget 2-column row cramped (label wraps to 2 lines) | `modal-invite-360-light.png` |

### R9. Charts
- Member detail daily spend (`div.bars` in the "Daily spend" card), 360/390: 10/10 value labels ("$7.4") wider than their
  bar column (+5 px) and touching neighbours. Shot `admin-member-detail-390-light.png`.
- 30-day bars (desktop "30 days") and daily active bars: labels cram; values only via `title` (hover-only).
- `SpendLine` uses `preserveAspectRatio="none"` at fixed 220 px height: strokes/dashes stretch on narrow cards (visual).
- Heatmap cells ≈ 17 px wide at 360 (OK), would drop under 12 px below 340.
- Hover-only data everywhere: `InfoTip` (`title`), bar values, heatmap cells, tool-mix bar, meter tick.

### R10. Landing (360–768)
- Header wraps into three rows; "Sign in" breaks onto two lines; header right group +7 px past its parent at 360.
- Hero product mock: floating alert card and "Priya · desktop" card overlap the spend card at 360.
- Timeline: 4 columns at ~60 px each; "Set a password" overlaps the step text below.
- Comparison table 39–42 % visible, not keyboard scrollable (axe serious).
- Demo form 2-column fields cramped (company placeholder cut "Acme Engine…").
- Wrapper `min-height: 7000px`. Shot: `landing-360-light.png`, `landing-768-dark.png`.

### R11. Other layout issues seen in the screenshots
- Overview Data health: status dot wraps above the text in 2 of 3 rows (QA note). `admin-overview-390-light.png`.
- Member detail header: name + pill + "Change budget" stack unevenly; budget card amount wraps under the title.
- Settings chips: 4 pill buttons wrap to 3 rows on phones; first always highlighted (QA A11Y-18).
- Desktop Sessions: filters row (search / tool / sort) wraps into 3 rows; detail panel tiles 3-up at 360 (tight).
- Toast covers the bottom of the page at 360 (`.toast` right 24 / max-width 420).
- Sticky sidebar at 640 px tall: fits today, but the side card has no scroll fallback.

## What is fine
- `/download/` and the desktop "unpaired" screen: no problems at any width.
- All pages at 1440 and 1920; all pages at 1024/1280 except the tables above.
- Cards, KPI rows and chart rows already wrap (`flex-wrap` + flex-basis); no fixed-width page containers.
- 960×640 desktop window: only the tour step 1 and the password-modal height issues.

## Files

- `audit.spec.ts`, `measure.ts`, `helpers.ts`, `playwright.responsive.config.ts`, `summarize.mjs` — rerunnable audit.
- `results/before/*.json`, `results/before/summary.md` — raw and grouped results (every selector).
- `axe-baseline.json` — 216 axe scans.
- `registry-before.txt`, `results/before/registry.json` — HKCU Run `AknologiaUsage` before/after the agent runs (unchanged:
  `"…\prebuilt\aknologia-agent-windows-amd64.exe"`).
