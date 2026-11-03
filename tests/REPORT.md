# Aknologia Usage — QA report

Date: 2026-10-10 · Environment: Windows 11, Docker Desktop, fresh Postgres 16 (compose volume reset before the run), server in `DEV_MODE=true` on :8080, agents in sandboxes under `tests/.sandbox/`. No product code was changed. Nothing was committed.

Detailed sections (full repro, evidence, file:line): `tests/api/RESULTS.md`, `tests/agent/RESULTS.md`, `tests/e2e/RESULTS-admin.md`, `tests/e2e/RESULTS-member.md`, `tests/a11y/RESULTS.md`, `tests/dx/RESULTS.md`.

## 1. Verdict

| Audience | Verdict | Why |
|---|---|---|
| Customers (admin + member) | **NOT READY** | 7 Blockers. Five can make spend and budget numbers wrong: rollup bugs for orgs not on UTC, backfill older than 40 days, one member able to freeze their own totals, admin session cost mispriced. Two are security holes: the login rate limit can be bypassed, and "code on new devices" is never enforced. All flows otherwise work end to end, and the numbers match in the cases tested. |
| Developers (setup + deploy) | **READY WITH FIXES** | Everything builds and runs, including Docker, `wails build` and migrations. But the image uses Go 1.22 (end of life, 63 known standard-library vulnerabilities), the installers on `/download/` are 404 and can't come from git as documented, codes are logged in production when SMTP isn't set, and the README is bash-only on Windows. |

**Lead re-grades.** Ground rule 4 makes "security hole" and "wrong numbers" Blockers, so I raised five findings the subagents graded Major:
- API-03, API-04 and MEM-04: wrong numbers.
- API-05 and MEM-02: security holes.

Duplicates found by more than one subagent are merged and noted in the "Also" column.

## 2. Findings

Severity: B = Blocker, M = Major, m = Minor, N = Note.

**Abbreviations:**
- `ah` = `backend/internal/api/admin_handlers.go`
- `auh` = `backend/internal/api/auth_handlers.go`
- `ui` = `ui/shared/ui.tsx`
- `css` = `ui/shared/theme.css`

### Blockers

| ID | Area | Title | Steps to reproduce | Expected | Actual | Suspected cause | Suggested fix | Also |
|---|---|---|---|---|---|---|---|---|
| API-01 | Backend / numbers | For orgs west of UTC, new usage stops appearing in totals | Org tz America/New_York → ingest an event at `<now-40d UTC date>T01:00Z` → ingest $1.50 + $0.75 now → GET member usage | Spend $2.25 | Ingest returns 200, but spend stays $0. Log: `rollup: duplicate key … daily_usage_pkey` (4× in this run). Budgets can't fire. | `usage.go:24-31`: DELETE uses `day >= since::date` (org-local day), INSERT uses `e.ts >= since::date` (UTC midnight). Lead confirmed in code. | Use the same org-local cut-off in both queries, or upsert | |
| API-02 | Backend / numbers | For orgs east of UTC (e.g. IST), events early on the oldest window day are dropped from rollups | Org tz Asia/Kolkata → ingest an event at `<now-40d>T00:00Z − 1h` | Counted in `daily_usage` / CSV | Missing, and every later ingest rebuilds the day without it | `usage.go:25` vs `:31` | Same fix as API-01 | |
| API-03 | Backend / numbers | Events older than 40 days are accepted but not counted until an admin presses Refresh (hits first-install history backfill) | Ingest an event at now−60d → GET overview for that month | $0.75 | $0 until `POST admin/refresh` | `ingest.go:97` accepts 2 years; `ingest.go:124` rolls up 40 days | Roll up from the oldest `ts` in the batch | |
| API-04 | Backend / security, numbers | A member can freeze their own totals and make Refresh fail (500) for the whole org | Member ingests 2 events with `input: 5e18`, then normal events → admin Refresh | Bad events rejected | `accepted:2`. That member's totals never update again, and Refresh returns 500 (`int64 out of range`) | `ingest.go:99-100` has no upper bound; `usage.go:44` scans a numeric sum into int64 | Cap tokens per event; isolate rollup failures per user | |
| API-05 | Backend / security | Auth rate limit bypassed with a spoofed `X-Forwarded-For` | DEV_MODE=false: 21 logins → 429 (correct); then 30 more, each with a new XFF | 429 | All 401; the limit never applies | `server.go:195-198` trusts the first, client-supplied XFF value | Use RemoteAddr, or the proxy-appended last hop; add a per-account limit | LAND-04 |
| MEM-02 | Backend / security | "Ask for a code on new devices" is on by default but never enforced | `POST /auth/login` from a new desktop device | Email code required | 200 + session token, no code | `auh:235-277`: login never reads `code_on_new_device` | Enforce it (OTP step in login, agent and window), or hide the switch until it is built | |
| MEM-04 | Backend / numbers | Admin "recent sessions" misprices sessions that use more than one model | Session with 2 sonnet + 3 haiku turns → admin member detail | $0.28 (as in the window) | $0.13, labelled haiku | `usage.go:274-300` prices summed tokens at the session's most common model | Sum the cost per event/model | |

### Majors

| ID | Area | Title | Steps | Expected | Actual | Suspected cause | Suggested fix | Also |
|---|---|---|---|---|---|---|---|---|
| API-06 | Backend / budgets | `PUT admin/budgets` doesn't reset this month's alerts (PATCH member does) | Budget $10, 80% alert sent → PUT members {id:20} → spend to $17.25 | New 80% alert | No new alert | `ah:684-691` | Share the reset logic for both paths | ADM-17 |
| ADM-05 | Backend / budgets | Changing a member's budget erases that month's alert log | Alerts sent → Members → Edit budget → Save → Budgets page | Log kept | "No alerts yet"; `budget_alerts` rows deleted | `ah` adminUpdateMember `DELETE FROM budget_alerts` | Reset de-duplication only (key on budget_cents or a reset_at column) | |
| API-11 | Backend / billing | A rejected Starter downgrade still changes the plan | `POST admin/billing/seats {seats:10, plan:"starter"}` | 400, nothing changed | 400, but the plan is now starter | `ah:778-784`: the UPDATE runs before validation | Validate first, then one transactional UPDATE | ADM-04 |
| MEM-01 | Agent / numbers | Active time differs: window 0.7 h vs admin 0.6 h | Sync fixtures; compare 7-day window with admin usage | Same (fixtures: 2220 s) | 0.7 h vs 0.6 h | `agent/internal/store/summary.go:156,233` round each session to minutes, then sum | Sum seconds; round only for display | |
| MEM-03 | Agent / privacy | Pause tracking doesn't leave a gap: paused activity is uploaded after resume | Pause → append a turn → resume → Force sync | No event (copy: "your admin sees a gap") | The paused turn is in `usage_events` | `agent/internal/syncer/syncer.go:342-345` only skips the scan; cursors stay | On resume, move cursors to end of file, or drop events in the paused window | |
| AG-01 | Agent / data loss | A session file replaced by a larger file silently loses events | Replace a file with a different, larger one → rescan | All new events read | 2 of 3 lost, unread=0 | `agent/internal/scan/scan.go:56` resets only when size < offset | Store a head-hash or file ID in the cursor | AG-02 |
| ADM-01 | UI / layout, a11y | No navigation below 860 px (admin and desktop) | Open any page at 390×844 | Menu or bottom nav | Sidebar `display:none`; Support and Settings unreachable | `css:184` | Hamburger drawer or bottom tab bar | A11Y-04, MEM-11 |
| ADM-02 | UI / tour | Tour stuck on phones at step 3 | 390 px, fresh org, tour step 3 | Next clickable | Tall KPI target (z 62) covers the card (z 61); Next/Skip can't be clicked | `ui:252-263`, `css:160-162` | Card z ≥ 63; clamp into viewport | |
| ADM-03 | UI / tour | Tour step 5 points at a hidden element on phones | 390 px, step 5 | Visible target | Points at a 0×0 element in the hidden sidebar | `ui/admin/main.tsx:71`, `ui:304` | Skip or retarget steps whose target has no size | |
| A11Y-01 | UI / a11y | Modals don't move, trap or return focus | Members → Invite (keyboard) → Tab | Focus inside; returns to trigger | Tab goes through 14+ controls behind the overlay; focus goes to `<body>` on close | `ui:131-151` | Focus trap + restore | |
| A11Y-02 | UI / a11y | Tour unusable by keyboard | Open the tour | Focus on card; Esc closes | No focus, Esc does nothing, Skip/Next 26 Tab stops away, no `aria-modal` | `ui:248-288` | Focus card, Esc handler, make the page inert | |
| A11Y-03 | UI / a11y | Invite email input has no focus indicator | Tab to `#inv-emails` | Visible ring | `outline:none` | `ui/admin/pages/Members.tsx:103-104` | `:focus-within` ring | |
| DX-03 | Backend / security, deploy | With DEV_MODE=false and no SMTP, codes are written to the log and signup returns 200 | Run the image with only DATABASE_URL → signup | Startup fails or warns loudly | Code in the log, no warning | `backend/internal/mail/mail.go:28`, `cmd/server/main.go:26` | Refuse to start without SMTP outside dev mode | API-15 |
| DX-04 | Deploy / security | Image built with Go 1.22 (end of life): 63 reachable standard-library vulnerabilities | `docker build`; `govulncheck -mode binary` | Supported Go | go1.22.12, 63 vulns; `node:20` also end of life | `Dockerfile:4,11`, `backend/go.mod:3` | golang:1.26-alpine (≥1.26.9), bump go.mod and the Node image | |
| LAND-03 | Deploy / members | All 3 installer links on `/download/` return 404, and the docs say to commit files that `.gitignore` excludes | HEAD `/download/aknologia-usage-*.{zip,tar.gz}` | 200 | 404 (invite emails link here) | `.gitignore` vs `docs/DEPLOY.md:115` | Publish installers elsewhere (release URL / DOWNLOAD_URL) or un-ignore; show "not published yet" | |
| LAND-02 | Landing | Demo booking: only one slot is clickable, and the dates are hardcoded and wrong | Click any other slot → submit | Chosen slot saved | Always "Wed 15 Oct 14:00" (15 Oct 2026 is a Thursday) | `landing/index.html:20,37-38` (8 of 9 buttons lack `class="slot"`) | Add the class; generate the dates | |
| DX-01 | Docs / Windows | README commands are bash-only and fail in PowerShell 5.1 | Paste README steps 2, 3 and the token line | Works, or PS equivalents given | `&&` parse error, `DEV_MODE=true` not recognized, `$(…)` fails | `README.md:32,36,59`, `DEPLOY.md` step 1.4 | Add PowerShell blocks | DX-02 |

### Minors

| ID | Area | Title | Steps / evidence | Suspected cause | Suggested fix |
|---|---|---|---|---|---|
| API-07 | Backend | Parallel guesses get past the 5-attempt code limit (6–10 attempts) | 40 parallel wrong codes | `auh:67-79` not atomic | Single `UPDATE … WHERE attempts<5 RETURNING` |
| API-08 | Backend | CORS allows look-alike origins (`localhost.evil.example`, `<PUBLIC_URL>.evil.com`); allows any localhost in production | `Origin` header test | `server.go:155` HasPrefix | Exact match; localhost only in dev |
| API-09 | Backend | CSV formula injection via member name | Name `=HYPERLINK(…)` → export | `ah:837` | Prefix `= + - @` with `'` |
| API-10 | Backend | `export.csv?from=notadate` → 500 | — | `ah:814-822` | Validate dates, return 400 |
| API-12 | Backend | Re-inviting a pending invite at full seats → 402 | 3/3 seats, re-invite pending | `ah:336-346` | Count only new users |
| API-13 | Backend | Events up to 24 h in the future are accepted and count toward budgets | Ingest now+23h | `ingest.go:97` | Allow about 10 min of skew |
| API-14 | Backend | Login reveals removed/invited state without the right password | Wrong password on a removed account → 403 removed | `auh:247-255` | Check the password first |
| ADM-06 | Backend | Devices still listed after password change revokes their sessions | Change password with 2 sessions | `auh` changePasswordConfirm/resetPassword | Revoke the devices too |
| ADM-07/08 | Admin UI | Sidebar plan card and org name stale until reload | Change plan / rename org | `ui/admin/main.tsx:116,135,140` | Reload `/me` after saves |
| ADM-09 | Copy | "Send 1 invites", "1 devices", "1 device(s)" | Invite modal | `Members.tsx:112` | Proper plurals |
| ADM-10 | Admin UI | Budgets alert log scrolls sideways at 390 px (423 px wide) | Budgets at 390 | `Budgets.tsx:86/308` | Wrap / stack | 
| ADM-11 | Admin UI | Org form overwrites typed input when the load finishes | Type quickly in Settings | `Settings.tsx:338` | Disable until loaded |
| ADM-12 | Product | Invited members never get a name; email used everywhere | Accept invite | `auh` acceptInvite | Ask for a name |
| ADM-13 | UI | Password checklist passes passwords containing the name, which the server rejects (code review) | — | `ui/shared/format.ts` vs `auth.go:98` | Pass the name to the checklist |
| ADM-19 | Admin UI | Tour targets of steps 4–5 are under the dim layer on desktop | 1440, steps 4–5 | `css:119,129,162` stacking | Separate highlight overlay |
| MEM-05 | Agent | Removed member stays signed in until the next sync (up to 1 h) | Remove member with window open | `localapi.go:105` | Poll `/agent/config` more often |
| MEM-06 | Copy / budgets | Banner says "Your admin has been emailed" when no alert was sent; budget change doesn't re-check budgets | Lower budget below spend → Force sync | `ui/desktop/pages/Overview.tsx:285,306`; `ah:416-421` | Check budgets on change, or soften the copy |
| MEM-07 | Agent | Force sync while paused says "Synced" | Pause → Force sync | `syncer.go:255` | Report the paused state |
| MEM-08 | UI | Top-bar search, ⌘K and bell do nothing (admin and desktop) | Click / type | `ui:317-318` | Wire up or remove |
| MEM-09 | Desktop UI | One click on the avatar signs out | Click the user button | `ui:323` | Menu with Sign out |
| MEM-10 | Copy | Wrong empty state for a search with no matches | Search "zz…" | `Sessions.tsx:383` | Separate copy |
| MEM-12 | Privacy | Ticket diagnostics include full local paths with the Windows user name | Bug report with diagnostics | `ui/desktop/main.tsx:129` | Send counts only |
| MEM-13 | UI | Settings section chips always highlight the first one (admin and desktop) | Click another chip | `Settings.tsx:436` / admin `:28` | Track the active section |
| AG-02 | Agent | Rewritten Codex file: `off:<offset>` ID collision drops new events | — | `parse.go:189` | Add total/ts to the ID |
| AG-03 | Agent / security | Local API Origin check is prefix-based (`localhost.evil.com` allowed; token still required) | — | `localapi.go:62` | Exact host match |
| AG-04 | Agent | Autostart is written on every start without opt-in, for any exe (including temp go-build paths), without args | Start the agent | `main.go:56-63`, `store.go:90` | Register from the installer/desktop only; opt-in |
| AG-05 | Agent | Partial `PUT /v1/prefs` resets the other prefs (UI not affected today) | — | `localapi.go:207-215` | Merge |
| AG-06 | Agent | Deleted files keep their cursors, so unread/file counts never drop | — | `scan.Once` | Prune cursors |
| AG-07 | Agent | Offline with an empty queue, Force sync reports "All synced" | — | `syncer.go:262-293` | Use the config refresh result |
| AG-08 | Agent | A 401 through `/v1/server/*` doesn't sign the agent out | — | `syncer.go:107-125` | Clear the token on 401 |
| A11Y-05..18 | UI / a11y | Silent error banners (no `role=alert`); errors only in a 3.5 s toast; focus lost on auth steps; OTP box can't be overwritten; input borders 1.18–1.90:1; chart marks below 3:1 and no text alternative; dark landing CTA 3.99:1; sign-in header clipped at 390 px (theme toggle off-screen); `aria-label` on role-less divs; no arrow keys on tabs/radios; no skip link | See `tests/a11y/RESULTS.md` | various (listed there) | listed there |
| Copy | Copy | Raw codes in invite results ("belongs to another org", "email failed"); "Refresh data" / "Refresh from database" / "Refresh now"; landing says "invite link" vs app "invite code"; vague backend errors ("Check the values and try again.") | — | `Members.tsx:91`, `ah:358-374` | Use one set of terms; say what to do |
| DX-02,05–11,13 | Dev / deploy | `make` not on Windows; APP_SECRET documented but never used; no warning for a missing PUBLIC_URL (links point to localhost); host port 5432 clash; render.yaml says "pooled" but DEPLOY.md says "direct"; Wails/Go versions in docs don't match `desktop/go.mod`; vite 5.4.11 high / esbuild moderate (dev only); no gzip / Cache-Control | See `tests/dx/RESULTS.md` | listed there | listed there |
| LAND-01,04 | Landing | 11 dead anchors (incl. Privacy/Terms/Cookies); demo endpoint accepts `"@"` emails and 2 MB messages, and nobody is notified | — | `landing/index.html:20`, `auh:376-389` | Real pages; validate, cap and notify |

### Notes

| ID | Note |
|---|---|
| API-16 | Token works without the `Bearer ` prefix (`server.go:108`). |
| API-17 | PATCH alert reset uses the DB's UTC month, not the org's (`ah:420`). Code review only. |
| ADM-14 | Team spend includes removed members' kept history but no row shows it; total vs rows differ by 1¢ (rounding). |
| ADM-15/16/18 | No empty state on the spend chart; CSV filename ignores Content-Disposition; invite link email not URL-encoded (`+` becomes a space). |
| AG-09 | Streamed duplicates keep the first line's usage, so the final output count may be lost. Needs checking on real CLI files. |
| AG-10..16 | Sync minute counts from UTC hours (:48 local in IST); a failed sync waits 1 h; a notification blocks sync about 5 s; prebuilt exe is a go1.22 console app (a console window would open at login); data in Roaming AppData with plaintext device token; project hash is case-sensitive; 200k events = 362–465 MB, summary up to 2 s. |
| MEM-14..18 | Split costs off by 1¢; autostart shared/default-on; breadcrumb shows the greeting; axe "needs review" items. |
| LAND-05..07, DX-12, DX-14 | localStorage not wrapped in try/catch; `/download/` ignores the chosen theme and has no link back; footer links 17 px tall; backend has no Go tests; render.yaml looks valid (not deployed). |

## 3. Coverage

**Tested and passed**
- **Auth:** signup/verify/login; every password rule; duplicate signup; member gets `403 not_admin`.
- **One-time codes:** wrong, expired, burned after 5 sequential attempts, and reused codes are rejected; reset via backup email works; rate limit 20/10 min per IP (when XFF isn't spoofed).
- **Invites:** seat limit (402), cancel, resend kills the old code, expiry, email mismatch, re-invite of a removed member.
- **Authorization:** a member gets 403 on all 18 admin routes; org A ↔ org B isolation (404); revoked, expired and removed tokens rejected.
- **Ingest:** idempotency; malformed events, negative tokens and 2001-event batches rejected; very old and far-future events rejected; attribution comes only from the token.
- **Money and time:** checked by hand to the cent across overview, member usage, `/me/usage`, CSV and per-model breakdown; active-time rule exact; IST month boundary correct.
- **Budgets:** 80/100% alerts exactly once each, toggles and inboxes respected.
- **Data:** deletion needs the code; deleteHistory true/false both work.
- **Secrets and headers:** passwords PBKDF2-600k; tokens and codes hashed; no hashes in any response; nosniff set. `scripts/e2e.sh` ALL_PASSED.
- **Agent parsers:** exact token numbers for all fixture types; incremental reads; partial lines; truncation.
- **Agent privacy:** zero prompt/code markers in the data dir or the DB; project paths HMAC-hashed.
- **Agent sync:** offline queue of 1200 events sent with nothing lost; NextSync jitter correct; 401 → signed out; removed → stops.
- **Agent local API and Windows:** token and foreign-origin checks enforced; autostart add/remove; notifications don't crash; prebuilt exe gives identical events.
- **Admin console:** every flow end to end (light 1440 full flow; other 3 theme × viewport combos: pages, screenshots, console, layout); overview numbers = API = independent math; empty states; zero console errors.
- **Member window:** invite (wrong code, mismatch, rules, success), tour, overview, budget banner, sessions, settings, Force sync, pause, support with diagnostics, sign out, forgot password, removed screen. Tokens, spend, sessions and cache share match the admin.
- **Accessibility:** axe on landing, `/download/`, auth, 6 admin pages, 5 modals and the tour (both themes); desktop window pages (both themes); keyboard pass; contrast from tokens.
- **Landing:** valid anchors, theme persists, monthly/annual prices switch, demo submit saves a row, Sign in → `/app/`.
- **Developer setup (PowerShell equivalents):** `npm install`, builds, typecheck, `go vet`, agent tests, `-migrate`, `docker compose up --build`, `docker build` (24 MB image), `wails build` (2 m 47 s, 11.5 MB exe).

**Not verified**
- **Email and sending:** real SMTP delivery (dev mode prints to the log); real Render/Neon deploy.
- **Desktop shell:** the real Wails window (`wails dev`) and OS toast notifications. The desktop window was tested in a browser.
- **Real session files:** behaviour on real Claude Code / Codex files was off-limits, so AG-09 and Codex resume/fork IDs are unconfirmed.
- **Not built yet:** the weekly summary and card payments.
- **Accessibility gaps:** screen readers (NVDA/VoiceOver), forced colours, 200% zoom, axe at 390 px on desktop pages, keyboard pass on the desktop window (same shared modal/tour code, so A11Y-01/02 likely apply).
- **Code review only:** API-17, ADM-13, ADM-18.
- **Other skipped flows:** rate limits on endpoints other than login/signup (same wrapper); "Send to backup email instead" reset path in the UI; `scripts/build-desktop.sh`.
- **Admin full flow** ran only in light-1440. Use `FULL_ALL=1` for all four combinations.

## 4. Numbers

| Suite | Tests | Passed | Failed | Notes |
|---|---|---|---|---|
| `scripts/e2e.sh` | 1 flow | ✔ | — | ALL_PASSED, $153.21 checked by hand |
| `tests/api/run.mjs` | 47 (295 checks) | 34 | 13 | every failure is a finding; OTP race test fails 7 of 9 runs (timing) |
| `tests/api/ratelimit.mjs` | 3 | 1 | 2 | API-05, API-15 |
| `agent go test ./...` / `go vet` | 2 | 2 | 0 | only `internal/parse` has tests; vet clean |
| Agent fixture checks (tests/agent) | 34 fixture files | all expected | — | first scan `files=34 new_events=156 unread_lines=5` as expected |
| `tests/e2e/admin.spec.ts` | 83 (45 skipped) | 34 | 4 | the 4 failures are "findings recorded" gates |
| `tests/e2e/member.spec.ts` | 13 | 12 | 1 | MEM-01 |
| `tests/e2e/landing.spec.ts` | 28 | 28 | 0 | |
| `tests/a11y` (axe + keyboard + layout) | 72 axe scans | — | — | 1 violation (dark landing CTA contrast) |

**Performance (agent, 200,000 events)**
- First scan: 23.0 s, 181 MB peak.
- Rescan with no changes: 2.4 s.
- Running agent: 362 MB, 465 MB peak.
- `/v1/status`: 0.25–0.30 s.
- `/v1/summary`: 0.8–2.1 s.
- `/v1/sessions`: 1.0–1.4 s (339 KB).

**Landing page weight**
- 6 requests, about 183 KB (HTML 80 KB uncompressed, fonts 101 KB).
- First paint about 0.5–0.7 s.
- Admin JS 239 KB (71 KB gzipped; the server sends it uncompressed).

**Accessibility violations per page (axe)**
- 0 on `/download/`, all auth screens, all admin pages, all modals and the tour, in both themes.
- Landing: dark has 1 (`color-contrast`, CTA subtext); light has 0.
- Desktop window: 0 in 32 scans (16 pages × 2 themes). "Needs review" items: color-contrast on auth pages (about 21 nodes, gradient background, passes when checked by hand) and `aria-prohibited-attr` (1 node).
- Manual contrast failures (inputs, chart marks, OTP focus) are in A11Y-08..11.

**Audits**
- `npm audit` in ui: 1 high (vite), 1 moderate (esbuild), dev only. tests/e2e: 0.
- govulncheck: source build on go1.26.4 has 12 (backend) / about 14 (agent) standard-library vulnerabilities, fixed in 1.26.5–1.26.9. The image binary on go1.22.12 has 63.
- Only third-party Go dependency: `lib/pq` v1.10.9.

## 5. Fix first (priority order)

1. **API-01 / API-02 / API-03:** rollup day-boundary and window bugs (`usage.go:24-31`, `ingest.go:124`). One change: use the same org-local cut-off and roll up from the oldest event in the batch.
2. **API-04:** cap token counts at ingest, and stop one user's failed rollup from breaking the org Refresh.
3. **MEM-04:** price admin recent sessions per model (`usage.go:274-300`).
4. **API-05:** rate-limit key from the trusted hop, not client XFF (`server.go:195-198`).
5. **MEM-02:** enforce or hide "Ask for a code on new devices" (`auh:235-277`).
6. **DX-03 + DX-04:** refuse to run without SMTP outside dev mode; move the image and go.mod to a supported Go (and Node).
7. **LAND-03:** make installers downloadable in a git-based deploy.
8. **ADM-05 / API-06 / API-11:** budget alert reset logic and plan validation order.
9. **AG-01, MEM-03, MEM-01:** agent file-replacement loss, pause gap, active-time rounding.
10. **ADM-01/02/03, A11Y-01/02/03:** phone navigation, tour on mobile and keyboard, modal focus, invite focus ring.
11. **LAND-02, DX-01:** demo slots; PowerShell instructions in the README.

## Environment state after the run

- The shared stack (`aknologia-db-1`, `aknologia-server-1`) is still running and holds the test data. Run `docker compose down -v` for a clean slate.
- All other QA containers and processes are stopped.
- The clean-copy folder remains at `%TEMP%\akn-clean`.
- **Registry:**
  - `HKCU\…\Run\AknologiaUsage` now points to `prebuilt\aknologia-agent-windows-amd64.exe`; a QA agent start wrote it (see AG-04).
  - Before QA it pointed to a stale temporary go-build exe left by an earlier `go run`.
  - The original value was not restored: the permission system blocked writing it back.
