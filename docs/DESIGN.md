# Design system

Both apps (admin console `ui/admin`, desktop window `ui/desktop`) share `ui/shared`: tokens and layout in
`theme.css`, components in `ui.tsx`, hooks in `hooks.ts`, breakpoints and motion numbers in `breakpoints.ts`,
formatting in `format.ts`, icons in `icons.tsx`. The landing page and `/download/` are static HTML that mirror the
same tokens.

## Look

| | Dark ("midnight emerald", default) | Light ("royal emerald") |
|---|---|---|
| Background / surface | `#08120F` / `#0F1C17` | `#F4F7F5` / `#FFFFFF` |
| Text / secondary / muted | `#F2F7F4` / `#CFDDD5` / `#9FB5A9` | `#0F1F18` / `#33473D` / `#526A5E` |
| Accent / accent ink | `#1E7D5E` / `#9FE0C6` | `#0E6B4E` / `#0A5139` |
| Gold (plan, kickers) | `#D4B373` | `#8A6416` |
| Heatmap levels 0–4 | `--heat0…4` | `--heat0…4` |

All colours are CSS variables on `:root` / `[data-theme]` in `theme.css` (surface, inset, raised, border,
border-strong, status colours `--ok-*`, `--no-*`, `--warn-*`, chart series `--s1`, `--s2`, overlay, shadows). Never
hard-code a colour in a component.

- **Theme:** `useTheme()` stores `system | light | dark` (`akn-theme` in localStorage) and sets `data-theme` on
  `<html>`. Switching adds `theme-anim` for 320 ms so colours cross-fade; first load never animates.
- **Type:** Sora (display headings, `.display`), IBM Plex Sans (body, 15 px / 1.5), IBM Plex Mono (numbers, codes,
  dates, `.mono`). Headings use `clamp()`.
- **Shape:** cards 18–26 px radius, buttons and inputs 12 px, pills fully rounded. Spacing on a 4/8 scale
  (gaps 10, 12, 16, 24; content padding 40 → 24 → 16 px as the screen narrows).

## Breakpoints

Defined once in `breakpoints.ts` (`BP = { sm: 480, md: 768, lg: 1024, xl: 1280 }`, `mq.below()/up()`); CSS repeats
the literals as `(max-width: <bp − 0.02>px)` / `(min-width: <bp>px)`. `tests/responsive/check-breakpoints.mjs`
fails on any other width. Mobile-first.

| Below | Changes |
|---|---|
| 1280 | Decorative auth chips and the org part of the breadcrumb hide; landing pricing 2×2 |
| 1024 | Sidebar becomes an off-canvas drawer opened by the menu button (desktop window keeps a compact 220 px sidebar down to 768 via `html[data-app=desktop]`) |
| 768 | Touch sizing (44 px targets, 16 px input text), modals become bottom sheets, tables become cards or scroll, top-bar search hidden, toasts full width |
| 480 | One-column forms, compact OTP boxes, two-line session rows, compact heatmap |

`pointer: coarse` repeats the touch sizing at any width. No horizontal page scroll from 320 px up; wide content
scrolls inside its own container (`TableScroll`, keyboard-focusable, edge shadow).

## Layout patterns

- **App shell** (`AppShell`): sidebar nav with a sliding active indicator, top bar (breadcrumb, search, bell, help,
  theme, avatar menu with Sign out), content area with a short page transition, footer
  "© 2026 Aknologia. All rights reserved." on every page. Skip link "Skip to content".
- **Drawer** (< 1024): focus-trapped, Escape and backdrop close, body scroll locked, `aria-expanded` on the button,
  closes when the window grows past 1024.
- **Tables:** stacked cards below 768 for lists of people you act on (Overview members, Members, Budgets; each cell
  has `data-label`); horizontal scroll with a sticky first column for read-only numeric tables (recent sessions,
  invoices, landing comparison). Alert log stacks.
- **KPI rows:** 1 column on phones, 2 on tablets, auto-fit on desktop; numbers count up once on first render.
- **Charts** (`StackedBars`, `SimpleBars`, `Donut`, `Heatmap`, `ShareRows`): sized from their container
  (`useElementWidth`), x-labels thinned when narrow, value labels only when there's room, a one-line readout on
  tap/focus/hover, roving-tabindex keyboard focus, and a visually hidden data table for screen readers. Heatmap uses
  4-hour blocks below 360 px.
- **Modals** (`Modal`): centred on desktop, bottom sheet with sticky actions below 768; focus moves in, is trapped,
  and returns to the trigger; Escape closes; enter and exit animate.
- **Tour** (`Tour`): card next to its target on desktop, docked at the bottom on phones; buttons always clickable;
  focus on the card, Escape closes; steps whose target is hidden in the drawer point at the menu button.
- **Forms:** `Field`, `PasswordField` + `Checklist` (rules from `format.ts` `passwordRules`), `OtpInput` (paste,
  overwrite, backspace), `Segmented`, `Tabs` (sliding thumb), `SwitchRow`, `InfoTip` (tap/focus popover).
- **Loading:** `Skeleton` blocks with a soft shimmer instead of "Loading…" text; refreshes keep the old view
  (no flash, no replayed animations).

## Motion

Tokens in `theme.css` (same numbers as `MOTION` in `breakpoints.ts`):

| Token | Value | Used for |
|---|---|---|
| `--dur-press` | 120 ms | button/card press `scale(.97)` |
| `--dur-hover` | 180 ms | hover colour/background |
| `--dur-enter` | 240 ms | modal, backdrop, toast, tour card, popover, tab/segmented thumb |
| `--dur-page` | 320 ms | page transition, drawer, sheet, theme cross-fade, bar grow, line reveal |
| `--ease-out` / `--ease-in-out` / `--ease-in` / `--ease-press` | cubic-beziers | entrances / thumbs and indicator / exits / press |

Rules: animate only `transform` and `opacity` (plus colour on hover); `tests/responsive/lint-motion.mjs` checks.
Data animations (bar grow, line draw, KPI count-up) run once per page load (`useFirstRender`); entrance animations
run on element insertion only, so re-renders and the desktop's 30 s status poll never replay them.
`prefers-reduced-motion: reduce` turns durations to ~0, disables count-up, shimmer, scroll reveal and chart draw-in.
The landing page reveals sections once on scroll (IntersectionObserver, staggered).

## Accessibility (WCAG 2.2 AA)

Semantic elements and labels; visible focus everywhere (`:focus-visible` 2 px accent ring); 4.5:1 text and 3:1
UI/chart contrast in both themes; error banners use `role="alert"`; motion never hides content. axe runs in
`tests/a11y` and `tests/responsive` (baseline: 0 new violations; the one known issue is the dark landing CTA
subtext at 3.99:1).

## Copy

Sentence case; consistent terms: **Force sync** (desktop), **Refresh data** (admin), **budget**, **invite code**,
**spend** (API-equivalent cost). Error messages say what happened and what to do. New strings need sign-off.
