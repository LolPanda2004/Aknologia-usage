# Status

Snapshot of what's been done and what's open (2026-10-10). Finding IDs come from `tests/REPORT.md` (the original
QA report); details, repro steps and evidence are there and in `tests/*/RESULTS*.md`.

## Done

**Data and money**
- Rollups use the same org-local day for delete and rebuild; backfill older than 40 days counts immediately;
  one member's bad data can't break Refresh (API-01, 02, 03, 04).
- Exact per-request list pricing (catalog, 5m/1h cache writes, long context, fast mode, US-only, web search,
  unknown = unpriced), verified on real data to the cent (see docs/PRICING.md). Admin session cost is per model
  (MEM-04). Agent keeps a streamed reply's final line and resends updates, including ones that change while a batch
  is in flight (AG-09). Desktop active time adds exact seconds (MEM-01).
- Budget alerts are per budget amount: changing a budget anywhere allows fresh alerts, history is kept, and alerts
  are checked right after the change (API-06, ADM-05, API-17, MEM-06).

**Security**
- Rate-limit spoofing (API-05) via `TRUSTED_PROXY_HOPS`; unenforced "code on new devices" switch hidden (MEM-02);
  atomic code attempts (API-07); Bearer required (API-16); exact CORS (API-08, DX-13); CSV formula escaping
  (API-09); login doesn't reveal account state (API-14); future timestamps limited to 1 h (API-13); no codes in
  production logs without SMTP (DX-03, API-15).

**Admin and member UI**
- Rejected plan change no longer changes the plan (ADM-04, API-11); sidebar plan card and header org name update
  after saving (ADM-07, 08); "Send 1 invite" (ADM-09); devices leave the list after a password change (ADM-06);
  re-invite of a pending invite at full seats (API-12); export date validation (API-10); invite link email is
  URL-encoded (ADM-18).
- Responsive and motion upgrade (all 9 planned steps + InfoTip popover): drawer navigation, table cards / sticky
  columns, bottom sheets, accessible tour and modals, skeletons, motion tokens. Before → after: 16 → 0 pages with
  horizontal scroll, 222 → 0 states without navigation, 588 → 0 small input fonts, axe 22 → 2 (known), 0 new.
  Fixes ADM-01, 02, 03, 10, 19, A11Y-01–04, 12, 13, 17, 18, MEM-09, 11, 13. Details: `tests/responsive/STEPS.md`.

**Landing and deploy**
- Demo booking: every slot selectable, next three business days (LAND-02). `/download/` says "Not published yet"
  for missing installers, DEPLOY.md explains publishing (LAND-03).
- Docker image on Go 1.26 (binary go1.26.9, govulncheck: 0), Node 22, Alpine 3.22 (DX-04).
- Migrations and the price-list seed take advisory locks, so two instances can start at once.

**Test status:** all suites green; see docs/TESTING.md for counts.

## Open

| ID | Severity | What |
|---|---|---|
| LAND-03 (part) | Major | Installers aren't built/published yet: run `scripts/build-desktop.sh` on macOS, Windows and Linux, then publish (DEPLOY.md step 5) |
| DX-01 / DX-02 | Major / Minor | README commands are bash-only; no PowerShell blocks; `make` not on Windows |
| AG-01 / AG-02 | Major / Minor | A session file replaced by a larger file loses events (cursor only resets on shrink); Codex `off:<offset>` ID collision on rewrite |
| MEM-03 | Major | Pause tracking doesn't leave a gap: paused activity is read after resume |
| AG-03 / MEM-16 | Minor | Agent local API origin check is a prefix match |
| AG-04 / MEM-15 | Minor | Autostart registered on every start without opt-in, for any exe path |
| AG-05–08 | Minor | Partial `PUT /v1/prefs` resets others; deleted files keep cursors; offline Force sync says synced; 401 via proxy doesn't sign out |
| MEM-05, 07, 08, 10, 12 | Minor | Removed screen waits for next sync; Force sync while paused says synced; search/bell do nothing; wrong empty state for no search results; ticket diagnostics include local paths |
| A11Y-05–07, 09–11, 14–16 | Minor | Some error banners lack `role=alert`; some errors only in a toast; focus not moved on auth step changes; input borders and chart marks under 3:1; landing CTA 3.99:1; `aria-label` on role-less divs; top-bar search does nothing on wide screens; arrow keys on tabs/radios |
| DX-05, 06, 07, 08, 09, 10, 11 | Minor | APP_SECRET unused; no PUBLIC_URL warning; port 5432 clash; Neon pooled vs direct wording; Wails/Go versions in docs; vite/esbuild dev advisories; no gzip/cache headers |
| LAND-01, 04 | Minor | Dead footer anchors (incl. Privacy/Terms/Cookies); demo endpoint accepts junk and notifies nobody |
| AG-10–16 | Note | UTC sync minute; 1 h retry after failure; notification blocks sync ~5 s; prebuilt exe is a console app on go1.22; Roaming data dir; case-sensitive folder hash; memory at 200k events |
| — | Note | Old agents (≤1.0.0) guess prices for unknown models in their own window; two old test members hold pre-cap 5e18-token events and fail to re-total |

## Not built yet

Card payments; weekly summary email; automatic 90-day deletion of raw events; agent auto-update; real enforcement
of "Ask for a code on new devices" (switch hidden until then).

## Not verified

Real SMTP delivery, a real Render/Neon deploy, the Wails window itself (`wails dev`) and OS notifications, screen
readers, installers on macOS/Linux.
