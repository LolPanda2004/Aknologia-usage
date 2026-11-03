# Responsive + motion upgrade — step log

Audit per step: `PHASE=after BASE_URL=http://localhost:8090 WIDTHS=390,1440` (8090 = local proxy serving ui/dist/admin at /app/,
landing/ at /, /api → :8080, so changes are visible without rebuilding the Docker image). Screenshots: `screenshots/after/<page>-<w>-<theme>.png`
(each step overwrites the previous step's shots; the final run is the full matrix).

## Step 1 — tokens + motion basics
- Files: `ui/shared/breakpoints.ts` (new: `BP`, `mq.below/up`, `MOTION`), `ui/shared/theme.css`, `ui/shared/hooks.ts`, `ui/shared/ui.tsx` (ThemeToggle).
- What: motion tokens `--dur-press/hover/enter/page`, `--ease-out/in-out/in/press`; breakpoint header comment; reduced-motion layer
  (tokens → 0, global .01ms safety net); buttons/icon/link buttons: colour transitions + `scale(.97)` press (filter hover → background
  colour; primary hover darkens 10% so white text keeps ≥ 4.5:1 in dark theme); `.click-card` hover/press class; nav item hover +
  `translateX(1px)` press; Tabs and Segmented sliding thumbs via `:has()` (Segmented options equal width, B8), with `@supports` fallback;
  theme toggle icon rotate-in and whole-page colour cross-fade only while `html.theme-anim` is set by a user switch (never first load).
- Hooks: `useMedia`, `usePrefersReducedMotion`, `useFirstRender(id)` (no-replay guard), `useElementWidth` (ResizeObserver).
- Why: PLAN §11 / brief motion system.
- Checks: typecheck + build OK. 390/1440 audit: no layout change; only "regressions" were a measurement artefact (new `span.theme-ico`
  counted separately inside the already-clipped auth header, fixed in step 6) and a hover contrast on the tour Next button (fixed).
- Shots: `screenshots/after/*-390-*.png`, `*-1440-*.png`.
- Undo: `node tests/responsive/undo.mjs 1`

### Incident during step 2 (fixed)
A mistyped config command ran `audit.spec.ts` with the default `PHASE=before` against step-2 code and overwrote part of the
baseline (web group: light at all widths, dark at 360/390/768; desktop files untouched). The baseline was regenerated from the
**pristine** sources (built from `.originals/pristine` into the scratchpad, served on :8091) and verified: the regenerated axe results
are identical to `axe-baseline.json` for every web state (0 differences). `results/before/web-*.json` and the matching
`screenshots/before/*` are pristine-code output again. For reruns: in Git Bash `GROUPS` is a reserved variable, so use
`env GROUPS=web npx playwright ...`.

## Step 2 — shell, drawer, top bar, page transition
- Files: `ui/shared/ui.tsx` (AppShell, new internal `UserMenu`), `ui/shared/hooks.ts` (`useFocusTrap`, `focusables`), `ui/shared/theme.css`,
  `ui/shared/icons.tsx` (+`menu` icon), `ui/desktop/main.tsx` (B3: `document.documentElement.dataset.app = 'desktop'`).
- What: below 1024 (desktop window: below 768; compact 220 px sidebar at 768–1023, the window minimum is 960) the existing
  `<nav class="side" id="side-nav">` becomes a drawer: menu button (`aria-controls`, `aria-expanded`, "Open menu"/"Close menu"),
  backdrop, focus trap (focus goes to the current item, Tab/Shift+Tab wrap, Escape closes and returns focus), `inert` on `.main-col`,
  `html.scroll-lock`, closes on resize past the breakpoint; choosing an item closes it and focuses the page `h1`. B4 sliding nav
  indicator (transform only, no transition on first placement). Top bar collapse (crumb org hidden < 1024, crumb + search hidden < 768 = B2(b),
  user name/role visually hidden but kept in the accessible name < 1024, one row on phones). D13: avatar opens a menu with
  "Sign out" (Escape / outside click / Tab close it). D9: "Skip to content" link to `#main`. Content-area page transition keyed by route
  only (`.page`, fill-mode `backwards` so no transform lingers). Sidebar `overflow-y: auto` for 640 px-tall windows.
  Padding 40 → 24 (< 1024) → 16 (< 768); fluid `h1` clamp(24px … 30px).
- Undo: `node tests/responsive/undo.mjs 2`

## Step 3 — tables
- Files: `ui/shared/ui.tsx` (new `TableScroll`), `ui/shared/theme.css`, `ui/admin/pages/{Overview,Members,Budgets,Member,Settings}.tsx`, `ui/desktop/pages/Overview.tsx`.
- What: pattern A (cards below 768, explicit table roles + `data-label`, C1) for Overview members, Members (actions in a full-width
  footer row, 44 px buttons) and Budgets (full-width 48 px budget input). Pattern B (`TableScroll`: labelled region, focusable only while it
  actually scrolls, right-edge fade, sticky first column with an edge shadow once scrolled) for recent sessions ×2, invoices, and the wide
  tables above 768. Table `min-width` moved to a CSS variable (`--min`) so the card layout can drop it. Alert log grid → `.alert-row`, stacks
  below 768, long emails wrap, the status dot no longer shrinks (ADM-10 / A11Y-13). Tool-mix bar gets an sr-only text equivalent.
- Undo: `node tests/responsive/undo.mjs 3`

## Step 4 — charts, KPIs, skeletons
- Files: `ui/shared/ui.tsx` (StackedBars, new SimpleBars, Heatmap, ShareRows, Kpi count-up, new Skeleton), `ui/shared/theme.css`,
  `ui/admin/pages/Overview.tsx`, `ui/desktop/pages/Overview.tsx`, `ui/admin/pages/Members.tsx`.
- What: bars measure their width (ResizeObserver): gap clamp(2, slot×0.2, 12), value labels only when the slot is ≥ 32 px, x labels thinned
  (k = ceil(n·40/width), first/last kept, hidden labels keep their slot); bar heights from `--plot` (smaller < 480). C3 one-line readout
  (aria-live polite) on tap/hover/focus with roving tabindex (one Tab stop per chart, arrows/Home/End); C4 sr-only data table per chart.
  Heatmap: same readout + roving focus, smaller gaps/cells < 480, C5 four-hour fallback when two-hour cells would be < 12 px (by measured
  width; at a 320 px viewport the cells are still ≈ 15 px, so it does not trigger in the matrix). SpendLine: `vector-effect: non-scaling-stroke`,
  height 220/180/150, reveal by a card-coloured mask scaling away (transform). Bars grow (scaleY) with a 15 ms stagger. KPI count-up
  480 ms (digits aria-hidden + sr-only final value; plain text again when done). All gated by `useFirstRender` (once per page load).
  Donut stacks above share rows < 480; share-row names ellipsis + title; cost-per-hour rows `.cph-row`. C6 skeletons with shimmer
  (Overview, Members, desktop Overview); the loading text stays in a `role=status` sr-only element. B7: admin Overview keeps the current data
  while "Refresh data" reloads. KPI values fluid; hero KPI full width < 768. Daily active members uses the shared bar component.
- Undo: `node tests/responsive/undo.mjs 4`
- Audit (steps 2–4 together, 390/1440): drawer checks pass (`check.spec.ts`: admin 390/960, desktop 390, desktop 960 compact sidebar).
  The remaining flags were measurement artefacts (visually hidden thead / user name counted as clipped) → `measure.ts` now ignores
  `clip: rect(0…)` hidden elements; real items fixed in step 8 (footer links, invite email input height). Chart marks (bars ≈ 25 px wide
  at 390) are a documented exception to the 44 px rule (one Tab stop per chart; the same data is in the readout and the sr-only table).

## Step 5 — modals → bottom sheets, tour, toasts
- Files: `ui/shared/ui.tsx` (Modal, Toast, Tour, internal `useExitGhost`), `ui/shared/theme.css`.
- What: Modal: D5 focus trap (first field focused, Tab wraps, Escape closes, focus returns to the trigger); the header no longer drops
  the close button onto its own row; overlay top padding clamp(24px, 12vh, 120px) + max-height with internal scroll (fixes 640 px windows).
  Below 768: bottom sheet (slides up 320 ms, grab bar, sticky action row with a top border, safe-area padding); < 480 the action buttons share
  the row. B5 exit animations for Modal and Toast without changing any close flow: on unmount a non-interactive snapshot (aria-hidden,
  inert, roles/ids removed) fades/slides out and is removed. Toast full width on phones. Tour: card `min(340px, 100vw − 32px)`, measured
  height, clamped inside the viewport, z-index 63 (D2), retargets to the menu button when the target is in a closed drawer (D3), lifts
  the sticky top bar/sidebar above the dim (D4), D6 focus trap + Escape + `aria-modal`, focus on Next each step, C9 docked bottom card
  below 768, per-step fade/slide (keyed by step), reduced-motion scroll `auto`.
- Undo: `node tests/responsive/undo.mjs 5`

## Step 6 — auth screens and forms
- Files: `ui/shared/ui.tsx` (AuthLayout class hooks), `ui/shared/theme.css`, `ui/admin/pages/Auth.tsx`, `ui/desktop/pages/Auth.tsx`, `ui/shared/Support.tsx`, `ui/admin/pages/Members.tsx`.
- What: header padding 22/48 → 16/24 → 12/16; Pricing/Book a demo hidden < 768 and "aknologia.com ↗" < 480 (D8; the theme toggle is always
  visible, A11Y-12); card padding via `--card-pad` 40 → 28 (< 1024) → 20 (< 480), the ribbon follows and wraps; fluid `h2`; decorative chips
  hidden < 1280. Inputs 16 px below 768 (no iOS zoom); `btn-sm` and Segmented 44 px below 768 and on `pointer: coarse`. OTP gap 6, 52 px
  tall, 22 px digits < 480 (fits 320); visible focus ring on OTP boxes and on the invite email chip field (D7). `.form-2col` (signup, invite
  role/budget, support severity/when) and the password checklist → one column < 480. Desktop "Server: …" link wraps.
- Undo: `node tests/responsive/undo.mjs 6`

## Step 7 — admin pages polish
- Files: `ui/shared/theme.css`, `ui/shared/Security.tsx`, `ui/shared/Support.tsx`, `ui/admin/pages/{Member,Settings,Budgets,Overview,Members}.tsx`.
- What: member detail header wraps cleanly (fluid name; the amount wraps under the title); Settings section chips: one horizontally
  scrollable row < 768 with an edge fade, all chips the same style (D10), reduced-motion-aware scroll; plan card price block aligns left
  when wrapped; inbox/invite chip "×" buttons get a 44 px hit area (padding + negative margin, same look); Data health text no longer
  drops under its dot; Security name/email/device rows wrap long values; Support type cards and Quick help links get hover/press motion.
  Security.tsx keeps the lead's MEM-02 change (no "Ask for a code on new devices" row).
- Undo: `node tests/responsive/undo.mjs 7`

## Step 8 — desktop pages
- Files: `ui/shared/theme.css`, `ui/desktop/pages/{Sessions,Settings,Overview}.tsx`.
- What: Sessions rows `.sess-row` (clickable-row motion) become two lines < 480 (project + cost / active + tokens); filters wrap
  (`.filter-field`); detail tiles `.tiles-3` tighter < 480; activity bars gap 3 → 1 px < 480; Settings sync tiles and source paths wrap
  (`overflow-wrap: anywhere`), which fixes the 485 px horizontal scroll at ≤ 390; Settings chips same as admin (D10). Also footer links
  and the invite email input are 44 px tall below 768.
- Undo: `node tests/responsive/undo.mjs 8`
- Audit (steps 5–8, 390/1440): remaining real items fixed before step 9 — sr-only chart tables widened the page (tables ignore
  `width: 1px`; now wrapped in a `div.sr-only`, and `.sr-only` gained `margin:-1px; clip-path`), section-chip row and sheet action bar
  no longer bleed past their parents (the sheet bar paints its gutters with box-shadow), chip "×" stays inside its pill, `.auth` uses
  `overflow: clip` (it was being scrolled sideways programmatically at 390), card-table cells lost their row borders and label font fix.
  Share-row ellipsis on long model names (e.g. `claude-sonnet-4-5-20250929`) is intended (full name in `title`).

## Step 9 — landing + /download/
- Files: `landing/index.html`, `landing/download/index.html`.
- What (landing, C8): class hooks on ≈ 80 elements, with the responsive inline properties moved into the page's `<style>` (no
  `!important` except the reduced-motion layer); `min-height: 7000px` removed (B6). Nav: menu button (`aria-expanded`, `aria-controls`,
  "Open menu"/"Close menu") < 1024 opens a disclosure panel under the header (48 px links, first link focused, Escape returns focus,
  choosing a link or clicking outside closes it, resets at ≥ 1024); "Sign in" and "Book a demo" stay in the header; announcement bar
  wraps. Hero stacks < 1024 (mock centred, max 560); floating mini-cards flow under the main card < 480; h1/h2 fluid clamp(). Bento
  6 → 2 → 1 (wide tiles span 2 at 768–1023). Timeline vertical < 1024 (numbered badges left, vertical connector). Pricing 4 → 2 (< 1280)
  → 1 (< 768), same order. Compare table: keyboard-focusable labelled region, sticky "Feature" column, scroll shadow on the right edge.
  Demo info/form stack < 1024, form 2-col → 1-col < 480, inputs 16 px < 768. Section padding 104/64 → 72/24 → 56/16, footer 4 → 2 → 1
  columns, 44 px footer/announcement links on touch. Team-view rows in the bento fit 320. Motion: same tokens as the app, press scale on
  buttons and button-like links, nav hover tint, theme cross-fade + icon rotate only on a user switch, scroll reveal (IntersectionObserver,
  threshold .15, once, 60 ms sibling stagger, above-the-fold and no-JS content never hidden, `:focus-within` always visible), reduced
  motion disables all of it. The old `@media (max-width: 900px)` `!important` hack is gone.
- What (/download/): h1 clamp(32px, 9vw, 44px); padding 72/24 → 40/16 < 768; button hover/press with the same tokens; D12: honours
  the theme chosen on the landing (`akn-theme` → `data-pref`, OS preference still used without JS) and adds a "← aknologia.com" link.
- Tests: `audit.spec.ts` `settle()` scrolls the landing once (instant) so revealed blocks are measured/shot in their final state.
- Undo: `node tests/responsive/undo.mjs 9`

## Step 10 — hover-only info on tap/focus (C2, PLAN §10)
- Files: `ui/shared/ui.tsx` (InfoTip), `ui/shared/theme.css`.
- What: `InfoTip` is now a `<button>` (accessible name = the definition text, as before) with a 44 px hit area around the same 15 px icon;
  the definition shows in a small popover on tap, hover or keyboard focus (`aria-expanded`, `aria-describedby` → `role=tooltip`), clamped
  inside the viewport; Escape, blur, an outside tap, scroll or resize close it. Bars and heatmap cells were covered in step 4 (readout +
  sr-only table); the tool-mix bar has sr-only text (step 3). Adds one Tab stop per info icon (approved in C2).
- Undo: `node tests/responsive/undo.mjs 10`
- Final-matrix follow-up (same step): the 44 px info-tip box no longer overflows its label (negative margin on the left/vertical only);
  pills in table cards / chip fields may wrap long emails; auto-fit grids use `minmax(min(Npx, 100%), 1fr)` so they fit 320 px
  (`g2`, `g4`, admin Settings organization grid, desktop Overview insight cards, desktop Privacy grid).
  Second follow-up: `.table-wrap` is `position: relative` (the tool-mix sr-only text escaped the scroller and widened the page at 1024);
  on `pointer: coarse` (touch tablets, the 768 touch run) inputs are 16 px and footer links / switch labels are 44 px, like below 768.
  Third follow-up: the top bar stays one row at every width (crumb shrinks with an ellipsis) — at 960×640 it had wrapped to two rows.
  Fourth follow-up: the search box shrinks first (`flex-shrink: 10`, min 160 px) and the breadcrumb org is hidden below 1280 (plan said < 1024)
  so page titles are not truncated; crumb parts carry a `title` with the full text.

## Final verification (summary)
- Matrix: 908 states (320–1920 + desktop 960×640, both themes). Widths ≥ 768 are from the last run on the final code; 320/360/390 are from
  the run before the last top-bar tweak (breadcrumb is hidden below 768, so those widths are unaffected).
- Before → after: h-scroll 16 → 0, overflow 98 → 0, off-screen 80 → 0, input font < 16 px 588 → 0, dialog/tour problems 20 → 0,
  hidden nav 222 → 0, chart label overlaps 4 → 0, tap < 44 px 1272 → 114 (OTP boxes 36–43 px wide = documented exception, plus one
  39 px-tall empty scroll region). Clipped text is intentional ellipsis (long desktop greeting / test org names in the breadcrumb,
  long model names in share rows, full text in `title`). Console: 2 transient (502 while the server image was being restarted, 401 during agent pairing).
- axe: 216 scans, 2 violations (both the known dark landing CTA contrast, A11Y-11, in the baseline); 0 new vs `axe-baseline.json` (was 22).
- `check.spec.ts`: 10/10 (drawer keyboard admin 390/960 + desktop 390, desktop 960 compact sidebar, modals fit 360/390/960/1440,
  reduced motion, no replay after admin Refresh, no replay across the 30 s desktop poll). `check-breakpoints.mjs` 0 bad; `lint-motion.mjs` 0 bad.
