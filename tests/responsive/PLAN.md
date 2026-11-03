# Responsive + motion upgrade — plan

Status: **plan only. No product code has been changed.** Nothing below is built until you reply "approved"
(and, separately, say which items in [NEEDS APPROVAL](#needs-approval--beyond-layout-and-motion) you accept).
Audit evidence: `tests/responsive/AUDIT.md`, screenshots in `tests/responsive/screenshots/before/`.

Ground rules kept everywhere: same midnight-emerald (dark) and royal-emerald (light) tokens, Sora / IBM Plex Sans /
IBM Plex Mono, `theme.css` variables, spacing scale, radii and copy. No new npm dependency.

---

## 1. Files to modify and why

| File | Why | Step |
|---|---|---|
| `ui/shared/theme.css` | Motion tokens, breakpoint rules, drawer, top-bar collapse, table cards / sticky columns, chart sizing, bottom sheets, toast, tour, auth, form sizing, touch targets, reduced motion. Almost all of the work is CSS here. | 1–8 |
| `ui/shared/breakpoints.ts` (new) | Single source of breakpoint numbers for TS (`BP`, `mq.below('lg')`, …). | 1 |
| `ui/shared/hooks.ts` | `useMedia(query)`, `usePrefersReducedMotion()`, `useFirstRender(key)` (no-replay guard), `useElementWidth(ref)` (ResizeObserver, for chart thinning); theme switch adds a short-lived `theme-anim` class (no first-load animation). | 1, 4 |
| `ui/shared/ui.tsx` | `AppShell` (menu button, drawer state, focus trap, scroll lock, backdrop, top-bar class hooks, content wrapper for page transition), `Modal` (sheet-friendly classes), `Tour` (placement on small screens), `Toast`, `StackedBars` / `Donut` / `Heatmap` / `ShareRows` (sizing, label thinning, first-render grow), `Kpi` (count-up), `ThemeToggle` (icon swap), `AuthLayout` (header class hooks), new `Skeleton`. No prop is removed or renamed (see NEEDS APPROVAL §B for additions). | 2, 4, 5, 6 |
| `ui/shared/Security.tsx`, `ui/shared/Support.tsx` | Replace inline 2-column grid styles with classes so they can collapse below 480 px; device rows wrap. | 6, 7 |
| `ui/admin/pages/Overview.tsx` | Members table → stacked cards < 768; cost-per-hour row grid; `SpendLine` sizing + draw-in; daily-active bars thinning; Data-health dot alignment. | 3, 4, 7 |
| `ui/admin/pages/Members.tsx` | Members table → stacked cards < 768 with 44 px actions; invite modal 2-col → 1-col < 480; chip remove buttons 44 px hit area. | 3, 5, 7 |
| `ui/admin/pages/Budgets.tsx` | Member budgets table → stacked cards < 768 (budget input full width, 44 px, 16 px font); alert log grid stacks (ADM-10 / A11Y-13). | 3, 7 |
| `ui/admin/pages/Member.tsx` | Header block wraps; budget card right-hand amount wraps under the title; recent sessions table → scroll + sticky first column. | 3, 7 |
| `ui/admin/pages/Settings.tsx` | Section chips → one horizontally scrollable row on phones; plan card header wraps; invoices table → scroll + sticky first column. | 3, 7 |
| `ui/admin/pages/Auth.tsx`, `ui/desktop/pages/Auth.tsx` | Signup 2-col grid → class (1 col < 480). | 6 |
| `ui/desktop/pages/Overview.tsx` | Recent sessions → scroll + sticky first column; donut + share rows stack; bars thinning on 30 days. | 3, 4, 8 |
| `ui/desktop/pages/Sessions.tsx` | Session list rows: 4-column grid → 2 lines < 480; filter row wraps; detail tiles. | 8 |
| `ui/desktop/pages/Settings.tsx` | Sync tiles (`g4`) and source rows: long server URL / path wrap (`overflow-wrap:anywhere`) — fixes the horizontal scroll at ≤ 390 px. | 8 |
| `landing/index.html` | Own `<style>` block: breakpoints, nav menu button + panel, hero stack, bento 6→2→1, vertical timeline, pricing stack, comparison table sticky column, demo stacking, scroll reveal, theme transition, reduced motion. Small additions to the existing inline script (menu, reveal). | 9 |
| `landing/download/index.html` | Fluid h1, 44 px targets, footer spacing, motion tokens (hover/press). | 9 |
| `tests/responsive/*` | Audit/verification spec, summariser, undo script. | all |

Not touched: `backend/`, `agent/`, `desktop/` (Go). `desktop/main.go` already sets `MinWidth 960, MinHeight 640` —
the window can't go narrower, so 960×640 is the smallest desktop case.

---

## 2. Breakpoint system (defined once)

| Name | Min width | Meaning |
|---|---|---|
| `sm` | 480 | below: one-column forms, full-width buttons in sheets, compact OTP |
| `md` | 768 | below: touch sizing (44 px controls, 16 px inputs), bottom sheets, table cards, toast full-width |
| `lg` | 1024 | below: sidebar becomes a drawer, user block → avatar, landing nav → menu button, hero stacks |
| `xl` | 1280 | below: two-column card rows tighten (e.g. Overview `flex-basis` 520 → 420), landing gutters 64 → 40 |

**How it is shared between CSS and TS (no PostCSS plugin):**

- Plain CSS can't use `var()` inside `@media`, and `@custom-media` needs `postcss-custom-media` (a new dependency,
  which we don't want). So the numbers live in **one TS file**, `ui/shared/breakpoints.ts`:
  `export const BP = { sm: 480, md: 768, lg: 1024, xl: 1280 } as const;` plus helpers
  `mq.below('lg') → '(max-width: 1023.98px)'` and `mq.up('lg') → '(min-width: 1024px)'`.
- `theme.css` writes the same literals, always as the pair `max-width: <bp - 0.02>px` / `min-width: <bp>px` (no
  overlap at exactly 1024), with a header comment pointing to `breakpoints.ts`.
- A guard in `tests/responsive` (`check-breakpoints.mjs`, part of the verification run) parses every `@media` in
  `theme.css`, `landing/index.html` and `landing/download/index.html` and fails if a width is not one of
  `480/768/1024/1280` (or the `-0.02` variants). One source of truth in TS, enforced literals in CSS.
- The existing ad-hoc queries (`860px`, `1180px` in `theme.css`; `900px` in the landing) are replaced by these.
- `pointer: coarse` is used in addition to width for hit-area enlargements, so a touch laptop at 1280 also gets 44 px.
- The landing and download pages are static HTML (no build), so they repeat the same four literals; the guard checks them.

---

## 3. Small-screen navigation (admin + desktop window)

Below 1024 px (`lg`):

- **Menu button** first in `.topbar` (`.icon-btn`, `aria-label="Open menu"`, `aria-controls="side-nav"`,
  `aria-expanded`). Hidden ≥ 1024.
- **Drawer:** the existing `<nav class="side" id="side-nav">` stays in the DOM (same markup, same nav buttons). CSS turns
  it into `position: fixed; inset: 0 auto 0 0; width: min(300px, 86vw); transform: translateX(-100%)`;
  open state `translateX(0)` (320 ms `--ease-out`, `transform` only). `visibility: hidden` when closed so it's not tabbable.
- **Backdrop** `.nav-backdrop` (`--overlay`, opacity fade 240 ms); click closes.
- **Focus trap:** on open, focus the current nav item; Tab / Shift+Tab cycle inside the drawer; `inert` on `.main-col`
  while open. **Escape** closes and returns focus to the menu button. Choosing a nav item closes the drawer and moves focus
  to the page `h1` (`tabIndex=-1`).
- **Body scroll lock:** `documentElement` gets `overflow: hidden` (+ `scrollbar-gutter: stable` to avoid layout jump) while open.
- Resizing to ≥ 1024 while open closes it and clears the lock (`useMedia`).
- Tour step "nav-account" (ADM-03) targets the menu button when the sidebar is a drawer — see NEEDS APPROVAL §D.

**Top-bar collapse:**

| Width | Breadcrumb | Search | Bell / help / theme | User block | Page actions |
|---|---|---|---|---|---|
| ≥ 1280 | full | 340 px field | icons | avatar + name + role | one row |
| 1024–1279 | full | 240 px field | icons | avatar + name | one row, wraps if needed |
| 768–1023 | title only (org hidden) | search **icon** button that expands the field over the top bar | icons | **avatar only** (name/role kept as sr-only text, so the accessible name doesn't change) | wrap |
| < 768 | hidden (the h1 says the same) | icon | icons, 44 px | avatar only | sync note on its own line; buttons wrap, primary first; `Segmented` full width |

Top bar becomes one 64 px row on phones (today it is ~215 px tall at 360: search, icons and user stack in three rows).
`.content`, `.topbar`, `.footer` side padding: 40 → 24 (< 1024) → 16 (< 768). `page-head h1` 30 → 24 px (< 768).

**Desktop window at its minimum 960×640** falls under 1024, so by default it gets the drawer too. Option to keep a
compact 220 px sidebar in the desktop window instead: NEEDS APPROVAL §B3.

---

## 4. Tables — one decision per table

Pattern A = **stacked cards < 768** (CSS on the same `<table>`: rows become cards, each `td` shows its column name from a
`data-label` attribute; explicit `role="table/row/cell/columnheader"` keeps table semantics after the `display` change).
Pattern B = **horizontal scroll with sticky first column** (`position: sticky; left: 0` on the first `th/td`, background
`var(--surface)`, a right-edge shadow that appears only while scrolled; the wrapper gets `tabindex="0"`, `role="region"`,
`aria-label` so keyboard users can scroll it — fixes axe `scrollable-region-focusable`).

| Table | Today (390 px) | Decision | Why |
|---|---|---|---|
| Admin Overview → **Members** (7 cols, `min-width: 900`) | 34 % visible; status pills clipped "Over budg…"; tool mix, budget used, last active off-screen | **A (cards)** | A list of people you scan and tap into; each row is one entity. Card: avatar + name/email (link) + status pill on top; then Active time · Spend · Last active as label/value pairs; budget meter full width; tool-mix bar. |
| Admin **Members** (manage, 7 cols, `min-width: 940`) | Actions column (Edit budget / Remove / Resend / Cancel) is 600 px to the right, off-screen | **A (cards)** | The actions are the point of this table; on phones they must be visible. Card footer row holds the 44 px action buttons, wrapping. |
| **Budgets** → member budgets (inputs, `min-width: 860`) | Budget input and meter split across the scroll | **A (cards)** | It's an editing form per member. Card: name + Custom/Default tag; full-width budget input (44 px, 16 px font); meter + "spent · %"; Projected and Alerts sent as pairs. |
| **Recent sessions** (admin member detail, 5 cols, `min-width: 540`) | 56 % visible | **B (scroll + sticky "Started")** | Read-only, numeric columns compared down the rows (Active, Cost); a few rows. Cards would lose the column comparison. |
| **Recent sessions** (desktop Overview, 6 cols, `min-width: 640`) | 48 % visible | **B (scroll + sticky "Started")** | Same reason; "View all sessions" leads to the card-like Sessions page anyway. |
| **Invoices** (Settings, 5 cols, `min-width: 560`) | scrolls | **B (scroll + sticky "Date")** | Financial records; column alignment of amounts matters; rarely more than 12 rows. |
| **Alert log** (Budgets; a CSS grid `150px 1fr 1fr`, not a table) | page scrolls sideways (423 px at 390, ADM-10) | **Stack < 768** | Three short facts per row: date (mono, small) on line 1; "Name reached 80 %" on line 2; "Emailed …" on line 3 with `overflow-wrap: anywhere`. |
| Desktop **Sessions list** (button rows, grid `2fr 1fr 1fr 1fr`) | project names clipped at 390 | **2-line rows < 480** | Line 1 project + cost; line 2 tool · time · active · tokens. Still one button per row (44 px+). |
| Landing **Compare plans** (`min-width: 820`) | 42 % visible, no keyboard scroll (axe serious) | **B (scroll + sticky "Feature")** | A comparison matrix only works as a grid; sticky feature names keep each row readable while plans scroll. |

Pattern A needs `data-label` attributes and roles on the `<td>`s (markup attributes, no structure change): NEEDS APPROVAL §C1.

---

## 5. Charts

All charts already sit in fluid cards; what breaks is fixed pixel heights/gaps and labels.

| Chart | Change |
|---|---|
| **Stacked bars** (`StackedBars`: daily spend admin/desktop; daily active bars) | `useElementWidth` measures the plot. Slot width = width / n. Gap = `clamp(2px, slot × 0.2, 12px)`. Bar max-width 46 px stays. Value labels above bars shown only when slot ≥ 32 px (else hidden; value stays in the tap/focus readout, §11). Height 200 → 160 px < 480. |
| **X-axis label thinning** | Show every k-th label, k = ceil(n × 40 px / width) (labels need ~40 px; "10-06" mono 12 px ≈ 36 px); always show first and last; hidden labels keep their slot (`visibility:hidden`) so bars and labels stay aligned. 30 days at 360 → every 4th day; 7 days at 360 → all. |
| **Cumulative line** (`SpendLine`) | Keep the 600×200 viewBox with `preserveAspectRatio="none"` but add `vector-effect="non-scaling-stroke"` so stroke widths/dashes don't stretch on narrow cards. Height 220 → 180 (< 768) → 150 (< 480). The 3 axis labels stay; legend wraps under the title < 480. |
| **Donut** | Fixed 140 px (fine). At < 480 it centres above the share rows instead of beside them (wrap already happens; fix alignment and gap). |
| **Heatmap** (7 rows × 12 two-hour cells) | ≥ 480: as today. < 480: gap 6 → 2 px, day label column 36 → 30 px, cell height 20 → 16 px; at 360 cells are ≈ 17 px wide (measured), ≥ 12 px target. **320 fallback**: below 360 the grid would drop under 12 px, so cells become 6 four-hour blocks (max level of each pair) with time labels 12a/8a/4p — this changes the data granularity shown: NEEDS APPROVAL §C5. |
| **Share rows** (`ShareRows`, spend by model, top projects) | Name gets `min-width:0` + ellipsis + full name in `title`; right-hand value `white-space:nowrap`; at < 360 the value moves under the name. |
| **Cost per active hour rows** (grid `140px 1fr 64px`) | < 480: `minmax(0, 96px) 1fr auto`; name ellipsis. |
| **Sessions → token split / activity bars** | Already fluid; activity bars gap 3 → 1 px < 480. |

---

## 6. Modals → bottom sheets, tour, toasts

**Modals (≥ 768):** unchanged look; overlay top padding `120px` → `clamp(24px, 12vh, 120px)` (fixes the password modal
running off a 640 px-tall desktop window); `max-height: calc(100dvh - 48px)` with internal scroll.

**Bottom sheet (< 768):** same `Modal` component, CSS only:
`.overlay { align-items: flex-end; padding: 0 }`, `.modal { border-radius: 22px 22px 0 0; max-height: 92dvh; overflow:auto;
padding: 20px 16px calc(16px + env(safe-area-inset-bottom)) }`, a 36×4 grab-bar via `::before` (decorative).
**Sticky actions:** the last action row in each modal (`.modal > .row:last-child`, `.modal form > .row:last-child`)
becomes `position: sticky; bottom: 0` on the sheet background with a top border, so Cancel/Save are always visible above
the keyboard. < 480: action buttons stretch (`flex: 1 1 0`), primary last (rightmost) as today. Close button 44 px stays.
Enter: sheet slides up (`translateY(100%) → 0`, 320 ms), backdrop fades (240 ms).

**Tour card:** `width: min(340px, calc(100vw - 32px))`. ≥ 768: current anchored placement, but clamped so the card
is always fully inside the viewport (today it assumes 220 px height). < 768: docked as a bottom card (`left/right 16px,
bottom 16px + safe area`); the target is scrolled so it sits in the upper part of the screen; very tall targets (KPI
column at 390 px, ADM-02) are not raised above the card. Step change: card fades/slides 8 px (240 ms). The
z-index/behaviour fixes it needs (ADM-02/03/19, A11Y-02) are listed in NEEDS APPROVAL §D.

**Toasts:** < 768: `left/right 16px, bottom 16px + safe area`, full width; ≥ 768 unchanged (right-bottom, 420 px).
Enter: fade + translateY(8px → 0) 240 ms.

---

## 7. Auth screens and forms

- `.auth-head` padding 22/48 → 16/24 (< 768) → 12/16 (< 480). Right group wraps; < 768 hide "Pricing" and "Book a demo"
  header links (both stay as links at the bottom of the page: "See pricing or book a demo"); < 480 also hide the
  "aknologia.com ↗" link (the brand logo links to the site). The theme toggle is always visible (A11Y-12: today it is
  pushed off-screen at 390).
- `.auth-main` padding 24 → 16 (< 480). `.auth-card` padding 40 → 28 (< 1024) → 20 (< 480), radius 26 → 20; ribbon
  margins follow; `h2` 30 → 24 px (< 480). Decorative rings stay; chips hidden < 1280 (was 1180).
- **Inputs:** `.input`, `select`, `textarea`, `.search input`, OTP: min-height 48 (44 for in-table inputs, was 40);
  **font-size 16 px below 768** (iOS zoom), 15 px above as today.
- **OTP at 320:** gap 10 → 6 px (< 480), box height 62 → 52, font 24 → 22. At 320 the six boxes are ≈ 37×52 px; at
  360 ≈ 42×52 px (width under 44 is a documented exception: six boxes must fit one row; height is 52).
- **2-column rows → 1 column < 480:** signup (name/email/company/size), invite modal (role/budget), support
  (severity/when), Budgets totals tiles stay 2-col (short numbers). Password checklist 2 → 1 column < 400 (< 480 rule).
- Segmented control and `btn-sm` grow to 44 px on touch (`pointer: coarse` or < 768).
- "Server: …" link on desktop sign-in wraps with `overflow-wrap:anywhere`.

---

## 8. Desktop window at 960×640 and free resize

- Default 1320×880 keeps today's layout. The window can be resized down to 960×640 (`desktop/main.go`).
- At 960 the shared rule makes the sidebar a drawer (unless §B3 is approved). Content gets the full 960 px: KPI row 2×2,
  chart rows stack (flex-basis already wraps), tables fit without scrolling except Recent sessions (sticky column).
- At 640 height: sticky sidebar gets `overflow-y:auto` (side card no longer pushes nav out); modals use the clamped
  top padding + `max-height` (§6); tour card clamped; toasts don't cover the primary button area (bottom-right, 16 px).
- Free resize: no layout depends on the initial width; everything is media/`ResizeObserver` driven, so dragging the
  window re-flows live (charts re-thin labels on resize, drawer closes when crossing 1024).

---

## 9. Landing page and /download/

Landing (`landing/index.html`, one inline-styled document):

- **Nav:** < 1024 the five section links collapse behind a **menu button** (`aria-expanded`, `aria-controls`), which opens a
  panel under the header (disclosure, not modal): links stacked 48 px tall, Escape closes and returns focus, choosing a
  link closes it. "Sign in" and "Book a demo" stay visible in the header; the announcement bar wraps to two short lines.
  Today the header wraps into three rows at 360 and "Sign in" breaks onto two lines.
- **Hero:** < 1024 copy and product mock stack (mock below, max-width 560, centred). h1 `clamp(38px, 8vw, 66px)`
  (replaces the `44px !important` hack). < 480 the floating mini-cards around the mock (alert card, "Priya · desktop")
  sit in normal flow under the mock instead of overlapping it (they overlap the spend card at 360 today).
- **Bento:** 6 columns ≥ 1024 (spans as today) → 2 columns 768–1023 (wide tiles span 2, others 1) → 1 column < 768.
- **Timeline (4 steps):** ≥ 1024 horizontal as today; < 1024 vertical: numbered dots in a left column, the connector
  line becomes vertical (`left: 24px; top/bottom: 24px; width: 2px`). At 360 today the four columns are ~60 px wide and
  "Set a password" collides with the text below.
- **Pricing:** 4 cards → 2×2 (768–1279) → 1 column (< 768), in the current order (Starter, Team, Business,
  Enterprise; no reordering). Monthly/annual toggle 44 px.
- **Comparison table:** pattern B (§4) with sticky "Feature" column and keyboard-focusable region.
- **Demo booking:** < 1024 info column and form stack; time-slot grid stays 3 columns down to 360 (buttons ≥ 44 px);
  form 2-col fields → 1 col < 480.
- Section padding 104/64 → 72/24 (< 1024) → 56/16 (< 768); footer columns 4 → 2 → 1.
- The wrapper's `min-height: 7000px` is replaced by normal flow (see NEEDS APPROVAL §B6).

/download/: h1 `clamp(32px, 9vw, 44px)`; main padding 72/24 → 40/16 (< 768); buttons 48 px stay; the three OS cards
already wrap (auto-fit 240). Footer link spacing ≥ 44 px targets. (Theme/back-link behaviour: §E.)

---

## 10. Touch targets and hover-only info

- Rule: every interactive element is ≥ 44×44 px at < 768 or on `pointer: coarse`. Inline text links inside sentences are
  exempt (WCAG 2.5.8 inline exception) but get ≥ 8 px vertical padding where they stand alone (footer, "Forgot password?").
- Fixes from the audit: `btn-sm` (38 px), Segmented buttons (36 px), in-table budget input (40 px), chip "×" remove
  buttons (12 px icon, no padding → 44 px hit area via padding + negative margin), footer links (17 px tall), landing nav
  links (44 px tall but < 44 wide for "FAQ" → min-width 44), checkbox-only controls (use the label as the target),
  OTP width exception (§7).
- **Hover-only info today:** `InfoTip` (only `title`), bar values (`title` per bar), heatmap cells (`title`), tool-mix bar
  (`title`), meter 80 % tick (`title`). Plan: `InfoTip` becomes a 44 px button that toggles a small popover on tap /
  Enter / Space and shows it on focus (Escape closes); bars and heatmap get a one-line **readout** under the chart that
  updates on tap/focus/hover ("Tue 7 Oct · Claude Code $1.20 · Codex $0.40"), plus a visually hidden data table for
  screen readers. These change markup/behaviour: NEEDS APPROVAL §C2–C4.

---

## 11. Motion system

**Tokens** (in `:root` of `theme.css`; the same numbers exported as `MOTION` from `ui/shared/breakpoints.ts` for JS-driven motion such as count-up):

| Token | Value | Used for |
|---|---|---|
| `--dur-press` | 120 ms | `:active` press |
| `--dur-hover` | 180 ms | hover / focus colour and background |
| `--dur-enter` | 240 ms | modal, backdrop, toast, tour card, popover enter |
| `--dur-page` | 320 ms | content-area page transition, drawer, sheet, theme cross-fade, bar grow / line reveal |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | enters, page, drawer |
| `--ease-in-out` | `cubic-bezier(.65, 0, .35, 1)` | sliding thumbs, nav indicator |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | exits (where used) |
| `--ease-press` | `cubic-bezier(.3, 0, .5, 1)` | press |

**Properties allowed:** `transform`, `opacity`, plus `color`, `background-color`, `border-color`, `fill`, `stroke`.
No width/height/top/left/margin/box-shadow/filter animation (the current `.btn { transition: filter }` becomes
background-color). The verification step greps `theme.css` and the landing styles for `transition`/`@keyframes` using
other properties.

**What animates:**

| Interaction | Motion |
|---|---|
| Buttons (`.btn`, `.icon-btn`, `.link-btn`, nav items) | hover bg/colour 180 ms; `:active` `scale(.97)` 120 ms (`.nav-item` uses `translateX(1px)`); none when `:disabled` |
| Clickable cards / rows (Support type cards, Sessions rows, member links/cards, Quick help links) | hover background + border-colour 180 ms; press `scale(.99)` 120 ms |
| Nav active indicator | Default: background/colour cross-fade 180 ms (CSS only). Sliding indicator bar: NEEDS APPROVAL §B4 |
| Sliding tab / segmented background | `.tabs::before` and `.seg::before` thumb moves with `transform: translateX(calc(var(--i) * 100%))` 240 ms `--ease-in-out`; `--i` comes from `:has(> button:nth-child(n)[aria-selected/pressed=true])` — no markup. Segmented options become equal width (inline-grid) so the thumb can slide (small visual change). |
| Modal / sheet / backdrop | backdrop opacity 0→1 240 ms; modal `opacity` + `translateY(8px) scale(.98)` → 0 / 1 240 ms; sheet `translateY(100%)` → 0 320 ms. Enter only by default (exit needs delayed unmount: §B5) |
| Tour | dim fades in once 240 ms; card fades + 8 px slide on each step (keyed by step index) |
| Toasts | enter fade + 8 px rise 240 ms (exit: §B5) |
| Page transitions | content area only (`.content` children, not top bar/sidebar): opacity 0→1 + translateY(6px→0) 320 ms on route change |
| Skeletons | KPI cards, chart cards and tables show skeleton blocks while the first load is pending; shimmer is a translated gradient (`transform: translateX`) 1.4 s loop; replaces the "Loading…" text cards (§C6) |
| Bars | first render only: `scaleY(0→1)` from the bottom, 320 ms, 15 ms stagger per bar (`--i`) |
| Line | first render only: reveal left→right by a mask `rect` (card colour) that scales `scaleX(1→0)` — transform-only alternative to `stroke-dashoffset` |
| KPI values | count-up on **first render only**, 480 ms ease-out, parsed from the formatted string (keeps "$", decimals, separators, " h", "x of y" uses the first number); visual digits `aria-hidden`, final value in sr-only text so screen readers never hear intermediate numbers |
| Theme toggle | sun/moon icon swaps with rotate(−90°→0) + fade 240 ms; whole-page colour cross-fade 320 ms only while a `theme-anim` class is on `<html>` (added on user toggle, removed after 320 ms) — **never on first load or OS-driven boot** |
| Landing scroll reveal | sections' direct blocks fade + rise 16 px 320 ms when they enter the viewport (IntersectionObserver, threshold 0.15, `unobserve` after first reveal); the hidden state is only applied when `html.reveal-on` is set by the script, so no-JS and above-the-fold content show immediately |

**prefers-reduced-motion: reduce:**
- CSS: all `--dur-*` → `0ms`; a global rule sets `animation-duration: .01ms; animation-iteration-count: 1;
  transition-duration: .01ms; scroll-behavior: auto` on `*`; skeleton shimmer stops (static block); scroll reveal is not
  armed; sheets/drawer appear without sliding (opacity only is also removed).
- JS: `usePrefersReducedMotion()` → count-up renders the final value immediately; chart grow/reveal classes not added;
  `Tour` and Settings chips use `scrollIntoView({ behavior: 'auto' })`; landing script checks `matchMedia` before arming reveal.
- Respected in the desktop window (WebView2 / WKWebView honour the OS setting).

**Guaranteeing nothing replays on re-render or the desktop 30 s status poll:**
1. All entrance animations are CSS `@keyframes` that run on **element insertion** only — React re-renders that reuse the
   same DOM nodes don't restart them. No `key` is ever derived from data values or `tick`.
2. Data-driven animations (bars, line, count-up) are gated by `useFirstRender(id)`: a module-level `Set` of ids
   (e.g. `admin-overview:daily-spend`) marked ~400 ms after first mount (timer, so React StrictMode's dev double-mount
   doesn't consume it). After that the component renders in its final state. The set lives for the page session, so
   navigating back to Overview doesn't replay either (one replay per page load at most).
3. The desktop poll (`tick` every 30 s) only refetches; `Overview` keeps rendering while `useAsync` reloads (it checks
   `!s`, not `loading`) — no unmount, no skeleton flash. Admin Overview currently unmounts on "Refresh data" (`loading ||
   !d`); changing that to keep the old view during reload is §B7.
4. Page transition is keyed by route (`active` + sub-path) only — not by `refreshKey`/`tick`.
5. Verification test (below) watches `document.getAnimations()` across a 31 s poll and a Refresh.

---

## 12. Verification plan

All in `tests/responsive` (rerunnable; `audit.spec.ts` + a `check` mode in the same spec):

1. **Layout matrix** — widths 320, 360, 390, 768, 1024, 1280, 1440, 1920 (+ desktop 960×640), both themes, every page,
   modal, tour step and empty state from the audit: fail on
   - horizontal scroll (`scrollWidth > clientWidth`);
   - any element overflowing its parent's right edge outside an intentional scroll container;
   - interactive element < 44×44 at ≤ 768 (exceptions list: inline links, OTP boxes width ≥ 36);
   - input/select/textarea font-size < 16 px at ≤ 768;
   - dialog/sheet/tour card/toast outside the viewport or primary action covered;
   - chart x-labels overlapping (label wider than slot) / value labels overlapping;
   - console errors other than blocked Google Fonts.
2. **Drawer keyboard test** (admin + desktop, 390 and 960): menu button has `aria-expanded=false` → Enter opens
   (`true`), focus is inside the drawer, 20× Tab never leaves it, Shift+Tab wraps, Escape closes and focus returns to the
   button, backdrop click closes, `documentElement` overflow is `hidden` while open and restored after, resizing to 1280
   closes it.
3. **Modals fit** at 360×740, 390×844, 960×640: sheet bottom = viewport bottom, actions visible without scrolling, inner scroll works.
4. **Reduced-motion run:** `REDUCED_MOTION=1`: every `getAnimations()` has duration ≤ 0.01 ms, KPI values equal final
   values on first frame, no reveal classes on the landing.
5. **No-replay test:** desktop Overview → wait 31 s (poll) → `getAnimations({subtree})` on charts/KPIs is empty and KPI
   text unchanged; admin Refresh data → no bar/count-up animation.
6. **Motion property lint:** no `transition`/`@keyframes` on non-allowed properties (grep script).
7. **Breakpoint guard:** `check-breakpoints.mjs` (§2).
8. **axe vs baseline:** wcag2a/2aa/21a/21aa/22aa on every state at 390 and 1440, both themes →
   `node summarize.mjs after --compare before` fails on any new violation id per page/width/theme
   (baseline: `axe-baseline.json`).
9. **Screenshots after:** `PHASE=after` → `screenshots/after/…`, same names as `before/` for side-by-side review.
10. **Builds:** `cd ui && npm run typecheck && npm run build:desktop && npm run build:admin`; then the server serves `/app/`
    with the new bundle — the Docker image copies `ui/dist/admin` at build time, so this needs the lead to run
    `docker compose up -d --build server` (I won't rebuild it myself), then `GET /app/` 200 and the new asset hash in the HTML.
11. Existing suites still pass: `tests/e2e` admin/member/landing specs (selectors like `nav.side` still exist),
    `tests/a11y` keyboard + axe.

---

## 13. Step order

Each step ends with: typecheck, the layout matrix for the affected pages, screenshots, and a short note of what changed.

| Step | Scope | Main files |
|---|---|---|
| 1 | Tokens + motion: breakpoints file, motion tokens, reduced-motion layer, button/card/hover/press, theme-toggle cross-fade, Tabs/Segmented thumbs, hooks | `theme.css`, `breakpoints.ts`, `hooks.ts`, `ui.tsx` (ThemeToggle) |
| 2 | Shell + drawer + top-bar collapse + page transition + skip link spacing | `ui.tsx` (AppShell), `theme.css` |
| 3 | Tables: cards (Overview members, Members, Budgets), sticky scroll (recent sessions ×2, invoices), alert log | page files, `theme.css` |
| 4 | Charts: bars thinning + grow, line reveal, donut, heatmap, share rows, cost-per-hour rows, count-up | `ui.tsx`, `Overview.tsx` (admin/desktop), `hooks.ts` |
| 5 | Modals → sheets, tour card placement, toasts | `ui.tsx`, `theme.css` |
| 6 | Auth screens + form sizing + OTP + 2-col → 1-col | `ui.tsx` (AuthLayout), `theme.css`, both `Auth.tsx`, `Support.tsx` |
| 7 | Admin pages polish (Member detail header, Settings chips/plan card, Budgets, Data health) | admin pages, `Security.tsx` |
| 8 | Desktop pages (Sessions rows, Settings tiles/paths, Overview), 960×640 checks | desktop pages |
| 9 | Landing + download | `landing/index.html`, `landing/download/index.html` |

---

## 14. Undo (no git repo)

- Before a step touches a file, its current content is copied to `tests/responsive/.originals/step-<N>/<repo path>`
  (e.g. `.originals/step-2/ui/shared/ui.tsx`). New files created in that step are listed in
  `.originals/step-<N>/created.txt`. The very first copy of each file is also kept in `.originals/pristine/<repo path>`.
- `node tests/responsive/undo.mjs <N>` restores every file saved for step N and deletes the files it created; steps are
  undone last-first (the script refuses to undo step N while a later step is still applied).
  `node tests/responsive/undo.mjs all` restores `pristine/` and deletes all created files.
- After an undo: typecheck + rebuild, so the dist folders match.
- Each step's `manifest.json` records the saved files (with the hash before the step), the created files and whether
  the step was undone (`node undo.mjs status`). The script already exists: `tests/responsive/undo.mjs`
  (`save <step> <files…>` is run before the first edit of each file in a step).

---

## NEEDS APPROVAL — beyond layout and motion

Nothing here is done unless you approve it item by item. "Default if not approved" says what I'd do instead.

### A. New dependencies
- **A1. None.** No PostCSS plugin (`postcss-custom-media`), no animation library, no focus-trap package, no
  headless-UI kit. Focus trap, count-up, IntersectionObserver and ResizeObserver are hand-written (≈ 120 lines total).

### B. Component API / props and behaviour in `ui/shared` and pages
- **B1. `AppShell`** gets internal state (drawer open), a new menu button, a backdrop element, `id="side-nav"` on the
  existing `<nav>`, class hooks on top-bar parts (`.topbar-crumb`, `.topbar-search`, `.user-meta`), and a wrapper
  `<div class="page" key={route}>` around `children` (for the page transition; the wrapper copies `.content`'s column/gap
  so spacing is unchanged). **No prop added, removed or renamed.** Needed for the drawer the brief asks for.
- **B2. Search on phones:** the top-bar search does nothing today (MEM-08 / A11Y-15). The brief's "search → icon" would add
  a second fake control (an icon that opens a field that does nothing). Options: (a) icon expands the existing input —
  per brief; (b) hide search below 768 until it is wired up. **Recommend (b).** Default if not approved: (a).
- **B3. Desktop window at 960–1023:** keep a compact 220 px sidebar (no drawer) in the desktop window only, via
  `document.documentElement.dataset.app = 'desktop'` set in `ui/desktop/main.tsx` (1 line) or an optional
  `AppShell` prop `drawerBelow?: number` (new optional prop). The window's minimum is 960, so with the plain rule the
  desktop app would always open its sidebar as a drawer at small window sizes. Default if not approved: drawer < 1024 everywhere.
- **B4. Sliding nav indicator:** one decorative `<span class="nav-indicator" aria-hidden>` in the sidebar, positioned
  with `transform` from the active item's `offsetTop` (measured in an effect). Default: background cross-fade only.
- **B5. Exit animations** for Modal and Toast: they need a "closing" state that delays unmount by 240 ms (Modal gets
  internal state; `onClose` is called after the animation; Escape/backdrop behaviour unchanged). Default: enter-only animations.
- **B6. Landing wrapper `min-height: 7000px`:** remove it (it's a fixed height that leaves empty space on wide screens).
  Default: keep it.
- **B7. Admin Overview keeps showing the current data while "Refresh data" reloads** (`loading || !d` → `!d`), so the
  page doesn't flash to "Loading team usage…" and animations don't replay. Small behaviour change. Default: leave as is
  (then a Refresh does replay first-render animations once, because the page remounts).
- **B8. `Segmented` options become equal width** (needed for the CSS-only sliding thumb). Visual only, but it changes
  the size of "This month / Last month", "Today / 7 days / 30 days", "System / Light / Dark". Default: thumb animates
  opacity in place (no slide).

### C. Markup restructuring beyond styling
- **C1. Tables → cards (Overview members, Members, Budgets):** add `data-label="…"` (the existing column header text) to
  every `<td>`, and explicit `role="table|rowgroup|row|columnheader|cell"` so table semantics survive the CSS display
  change; actions cell gets a class. Landing table + app `.table-wrap` get `tabindex="0" role="region" aria-label`.
  Without approval: tables stay horizontal-scroll everywhere (pattern B with sticky column for all), which fixes overflow but
  not the hidden actions.
- **C2. `InfoTip` becomes a `<button>`** with a tap/focus popover (`aria-expanded`, `aria-describedby`); today it is a
  `span role=img` with `title`. Changes the accessible role and adds a tab stop per info icon (≈ 9 on admin Overview).
- **C3. Chart readout:** a one-line `aria-live="polite"` readout under `StackedBars` / `Heatmap` updated on tap, focus
  or hover; bars/cells become focusable via roving tabindex (one Tab stop per chart, arrow keys move). Adds markup and keyboard behaviour.
- **C4. Visually hidden data table** for each chart (screen-reader alternative; overlaps A11Y-10).
- **C5. Heatmap 320 px fallback** shows 6 four-hour blocks (max of each pair of two-hour cells) — changes data granularity
  at < 360 px. Default: keep 12 cells and accept ≈ 15 px cells at 320.
- **C6. Skeletons replace the "Loading team usage…", "Loading members…", "Reading your usage…" cards.** The text stays,
  visually hidden, in a `role="status"` element. New `Skeleton` export in `ui/shared/ui.tsx` (additive).
- **C7. Inline styles → classes:** the 2-column form grids, alert-log grid, cost-per-hour grid, Sessions row grid,
  Settings chips row and several `flex: 'x y z'` card rows use inline `style={{…}}` which media queries can't override
  without `!important`. I'd move those specific inline styles into named classes (same values ≥ the breakpoint).
  Purely presentational, but it edits JSX in ~10 files. Alternative: attribute-selector + `!important` overrides in CSS
  (zero JSX change, fragile). **Recommend classes.**
- **C8. Landing:** add class names (`.l-hero`, `.l-bento`, `.l-tile-wide`, `.l-timeline`, `.l-pricing`, …) to ≈ 40
  elements, a menu `<button>` + `id` on the nav, `data-reveal` on reveal blocks, and ≈ 40 lines in the existing inline
  script (menu disclosure, reveal observer, theme cross-fade). No text or order changes. Alternative: attribute
  selectors on the inline styles (as the current `[style*='grid-column: span']` hack) — no markup change, fragile.
- **C9. Tour on phones docks at the bottom** instead of pointing at the target (positioning logic change in `Tour`).

### D. Overlaps with QA findings (would change behaviour)
- **D1. ADM-01 / A11Y-04 / MEM-11 (no nav < 860):** fixed by the drawer (§3) — that is the brief, listed here because it
  changes behaviour on phones and tablets (and moves the hide point from 860 to 1024).
- **D2. ADM-02 (tour stuck at step 3 on phones):** card `z-index` 61 → 63 (above the highlighted target at 62) and clamp
  into the viewport. Pure stacking, but it changes which element receives clicks.
- **D3. ADM-03 (tour step 5 targets the hidden sidebar):** when a step's target has no size, retarget to the menu button
  (or skip the step). Changes tour content flow on phones.
- **D4. ADM-19 (tour targets 4–5 under the dim layer on desktop):** while the tour runs, the sticky `.topbar`/`.side`
  ancestor of the target gets a raised `z-index` (class added/removed by `Tour`).
- **D5. A11Y-01 (modal focus trap/restore):** the drawer needs a focus trap anyway; reusing it in `Modal` (focus first
  field on open, trap, restore focus to the trigger) is a behaviour change to every modal. Recommend yes.
- **D6. A11Y-02 (tour keyboard):** focus the card's Next button per step, Escape closes, `aria-modal`. Recommend yes,
  same trap code.
- **D7. A11Y-03 (invite email field focus ring)** and **A11Y-08 (OTP focus ring)**: add `:focus-within` / `:focus-visible`
  rings while restyling those inputs. Small visual change.
- **D8. A11Y-12 (auth header clipped at 390):** fixed by hiding Pricing/Book-a-demo/site links in the header on small
  screens (§7) — content visibly removed from the header at < 768 (still on the page below).
- **D9. A11Y-17 (skip link):** add "Skip to content" (new visible-on-focus link + `id="main"`) — new copy ("Skip to content").
- **D10. A11Y-18 / MEM-13 (Settings chips always highlight the first):** on phones the chips become a scroll row; making
  them all the same style (or tracking the section in view) changes their look/behaviour. Recommend same style for all.
- **D11. A11Y-06 (errors only in 3.5 s toast):** not changed. Toast timing stays 3.5 s; only position/animation change.
- **D12. LAND-06 (/download/ ignores the chosen theme, no link back):** read `akn-theme` in a 3-line script and add a
  "← aknologia.com" link (new copy). Default: layout-only changes on /download/.
- **D13. MEM-09 (one click on the avatar signs out):** collapsing the user block to an avatar makes this easier to hit by
  accident on phones. Option: avatar opens a small menu with "Sign out" (new behaviour/markup). Default: keep the current
  one-click sign-out, with the sr-only accessible name "Sign out, {name}" kept.

### E. Copy changes
- None planned. Only the new strings implied by approved items: "Open menu" / "Close menu" (menu button labels), "Skip to
  content" (D9), "← aknologia.com" (D12), "Search" (icon button label, B2a), chart readout strings built from existing
  labels (C3). Uppercase kickers stay as written.
