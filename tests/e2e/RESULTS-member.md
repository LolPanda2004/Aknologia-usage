## 4. Member experience end-to-end

Desktop window (browser build, Vite :5174) + sandboxed agent (127.0.0.1:47811, data/home under `tests/.sandbox/member`) + dev server :8080. Run date 2026-10-10, local TZ IST (+05:30), org TZ UTC.

### How to run
1. `cd agent && go build -o ../tests/bin/aknologia-agent.exe ./cmd/aknologia-agent`
2. `node tests/fixtures/member/gen.mjs` (fixtures relative to today; 6 sessions, 5 in the last 7 days, all 7-day ones in October)
3. `cd ui && npm run dev:desktop` (port 5174)
4. `cd tests/e2e && npx playwright test -c playwright.member.config.ts`
   The spec wipes `tests/.sandbox/member/{data,home}`, copies fixtures, starts/stops its own agent, creates admin `qa4-<rand>@example.test`, invites `member-qa4-<rand>@example.test`, reads codes from `tests/.server.log`, and puts the HKCU Run value back to what it was at start.

Files: `tests/e2e/member.spec.ts`, `tests/e2e/member-helpers.ts` (replaced), `tests/e2e/playwright.member.config.ts`. Evidence: `tests/e2e/test-results-member/{observations,checks,console-errors}.json`.

### Test counts
13 tests: **12 passed, 1 failed**. The failure is the deliberate number-match check (MEM-01, active time 0.7 h in the window vs 0.6 h for the admin). Console errors: **0 unexpected**. The 5 recorded errors are all expected 4xx responses from the negative tests (wrong invite code ×2, wrong current password, wrong sign-in password, wrong reset code).

### Findings
| ID | Sev | Title | Repro | Expected | Actual | Suspected cause | Suggested fix |
|---|---|---|---|---|---|---|---|
| MEM-01 | Major | Active coding time differs between window and admin | Sync the fixtures. Compare the 7-day window with admin member usage (month) | Same hours (fixtures: 2220 s, so 0.6 h) | Window **0.7 h**, admin **0.6 h** (API and console) | `agent/internal/store/summary.go:156` rounds each session to whole minutes (`math.Round(active/60)`), then `:233` adds up the rounded minutes (39 min). The server adds up seconds | Keep seconds per session. Round only for display |
| MEM-02 | Major (security) | "Ask for a code on new devices" is never enforced | Settings shows the switch on (the default). `POST /auth/login` from a new desktop device name | An email code is needed | 200 with a session token, no code issued | `backend/internal/api/auth_handlers.go:235-277`: `login` never reads `code_on_new_device` (it is only stored, at :496) | Check for a known device, issue an OTP, add a step to the agent and window login. Or hide the switch |
| MEM-03 | Major | Pause tracking does not leave a gap. Paused activity is uploaded after resuming | Pause, append a turn, wait 25 s plus Force sync (no event, correct). Resume, then Force sync | Copy says "Stops reading new activity… your admin sees a gap" | Paused turn `msg_paused_1` is read after resuming: events.jsonl 25→26, 1 row in `usage_events` | `agent/internal/syncer/syncer.go:342-345` only skips the scan. Cursors stay put, so the backlog is read later | When resuming, move cursors to end of file (or drop events whose time falls in the paused period) |
| MEM-04 | Major (wrong numbers, admin side) | Admin "recent sessions" misprices sessions that use more than one model | Session web-dashboard (2 sonnet + 3 haiku turns) | $0.28 (window, per-event pricing) | Admin member detail **$0.13**, model shown is haiku | `backend/internal/api/usage.go:274-300` prices the session's summed tokens at its most common model (`mode()`) | Add up cost per event/model in SQL (`GROUP BY model`) |
| MEM-05 | Minor | Removed member keeps the signed-in window until the next sync | Admin `DELETE /admin/members/{id}`, wait 35 s with the window open | Removed screen soon after | Window still signed in (up to the hourly sync). Removed screen only after Force sync. Tracking then stops (verified) | `/v1/status` (`agent/internal/localapi/localapi.go:105`) never contacts the server. Config refresh happens only on sync | Refresh `/agent/config` every few minutes, or on a window status poll |
| MEM-06 | Minor | Banner says "Your admin has been emailed" when no alert was sent | Admin lowers the budget to $1 (spent $3.83), member presses Force sync | Banner only after an alert was sent, or an alert is sent on budget change | Banner plus "Budget reached. Your admin has been emailed." but `budget_alerts`=0. The alert was only sent after a new event was ingested | `ui/desktop/pages/Overview.tsx:285,306` (copy). Budgets are only checked on ingest, and PATCH member (`admin_handlers.go:416-421`) does not check them | Check budgets on budget change, or soften the copy |
| MEM-07 | Minor | Force sync while paused says "Synced. 0 events waiting." | Pause, then Force sync | "Tracking is paused, nothing was sent" | Success toast | `syncer.go:255` returns nil when paused. `ui/desktop/main.tsx:112` | Return or show the paused state |
| MEM-08 | Minor | Top-bar search and notifications bell do nothing. Shows "⌘K" on Windows | Type "billing" + Enter in the top search. Click the bell | Search sessions/settings. Show notifications | No effect | `ui/shared/ui.tsx:317-318` (no handlers) | Wire them up, or remove them from the desktop shell |
| MEM-09 | Minor | Clicking the avatar/name signs out at once | Click the top-bar user button | A menu or confirm | Signed out immediately | `ui/shared/ui.tsx:323` | Menu with "Sign out" |
| MEM-10 | Minor | Wrong empty state for a search with no results | Sessions, search "zz-no-such-project" | "No sessions match…" | "No sessions in the last 30 days" | `ui/desktop/pages/Sessions.tsx:383` | Separate copy for filtered and truly empty lists |
| MEM-11 | Minor | Settings overflows at 390 px | Settings at 390 px width | No horizontal scroll | 95 px overflow (long source paths in mono text do not wrap). Also: below 860 px the sidebar is hidden with no other navigation (`theme.css:184`). The real Wails window has MinWidth 960, so this matters only in a browser | `ui/desktop/pages/Settings.tsx:452` | `overflow-wrap:anywhere` / ellipsis. Add mobile nav if narrow widths are supported |
| MEM-12 | Minor (privacy) | Ticket diagnostics include full local paths (with the Windows user name) | Send a bug report with "Include diagnostics" ticked | "App version, operating system, and sync status" | `diagnostics.sources[].path/roots` hold `C:\Users\Admin\...` paths | `ui/desktop/main.tsx:129` sends `status.sources` as is | Send only tool/found/files/unread counts |
| MEM-13 | Minor | Settings section pills always highlight "Account and security" | Click "Preferences" | Active pill follows the section | First pill stays primary | `ui/desktop/pages/Settings.tsx:436` (`k === 0`) | Track the active section |
| MEM-14 | Note | Token-split costs don't add up to the session cost | Opus session detail | Parts add to $2.52 | Parts add to $2.53 | Each part rounded on its own (`summary.go:157`) | Round once, or show the remainder |
| MEM-15 | Note | Autostart is on by default and shared | Start the agent | Asks first. One owner per machine | Every agent start writes HKCU Run `AknologiaUsage` (`main.go:61-63`, default `store.go:90`) with no arguments (`-server` is lost). The pre-QA value is a temporary `go-build…` path left by `go run`. During this QA another run changed the shared value to `prebuilt\aknologia-agent-windows-amd64.exe` | `agent/cmd/aknologia-agent/main.go:61`, `agent/internal/autostart/autostart.go` | Make it opt-in at first run. Skip temp executables. Store the args |
| MEM-16 | Note (code review, not exploited) | Local API origin check uses a prefix match | Origin `http://localhost.evil.com` | Rejected | Accepted by `strings.HasPrefix` (CORS headers echoed). The token is still required, so the risk is low | `agent/internal/localapi/localapi.go:62` | Parse the origin and match the host exactly (`localhost`/`127.0.0.1`, any port) |
| MEM-17 | Note (a11y) | axe "needs review" items | See the a11y summary | — | `aria-prohibited-attr`: `aria-label` on the password Checklist `<div>` with no role (`ui/shared/ui.tsx:72`). `color-contrast` could not be computed for about 21 nodes on auth pages (text over the decorative rings/chips) | — | Add `role="list"`/`group`. Check contrast on auth pages by hand |
| MEM-18 | Note | Breadcrumb shows the greeting. Greeting uses the email local part | Overview for a member without a name | Breadcrumb "Overview". Name or no name | "Good morning, Member-qa4-…" in the breadcrumb and h1. The top bar also wraps the user button onto a second line at 1440 px with a long email | `ui/desktop/main.tsx:119,133` | Use the page label in the breadcrumb. Drop the name when there is none |

### Number match evidence (after Force sync; 7-day window = all October fixture events)
| Metric | Fixture oracle (independent parse) | Window UI | Agent `/v1/summary?days=7` | Admin API `/admin/members/{id}/usage` (month) | Admin console | DB `usage_events` |
|---|---|---|---|---|---|---|
| Tokens | 1,688,900 | 1.7M | 1,688,900 | — (not in kpis) | — | 1,688,900 (22 events) |
| Spend | — | $3.83 | 3.83 | 3.83 | $3.83 | — |
| Sessions | 5 | 5 | 5 | 5 | 5 | 5 (+1 in Sept) |
| Active time | 2220 s = 0.6 h | **0.7 h** | **0.7** | **0.6** | **0.6 h** | — |
| Cache share | — | 87% | 87 | 87 | 87% | — |
| Budget | — | $3.83 of $1 (383%) | — | spentCents 383, budget 100 | — | — |

Today: 1 session / 661K / $0.57. 30 days: 6 / 1,953,300 tokens / $4.06. Both match the oracle. The streamed duplicate is counted once (opus session = 6 turns). The `<synthetic>` line is skipped. Repeated Codex token reports are skipped. Unread lines = 0. Per-session admin vs window: all match except MEM-04 (web-dashboard $0.13 vs $0.28).

### Desktop axe summary (`tests/a11y/desktop-axe.json`, `.md`)
Tags wcag2a/2aa/21aa/22aa. 16 pages × 2 themes = 32 scans at 1440 px: unpaired screen, sign in (first run and after sign-out), invite, tour, overview, overview with budget reached, sessions, settings, password modal (both steps), server modal, support, forgot (email/code/new password), removed. **0 violations on every page.** Needs review: `color-contrast` incomplete on auth pages (~21 nodes each) and the tour. `aria-prohibited-attr` (1 node) on invite, new-password and password-change pages (MEM-17).

### Screenshots (`tests/e2e/screenshots/member/`, 68 files)
Each listed page in light and dark at 1440 and 390 px: signin-first-run, invite, tour-step1, overview, overview-budget-reached, sessions, settings, support, signin, forgot-email, forgot-code, forgot-new-password, removed. Password modal steps and server modal: 1440 only. Extra shots: unpaired-bad-token, invite-rules-met, invite-wrong-code, overview-30days, sessions-no-results, sessions-detail-opus, settings-devices-two, settings-paused, support-after-submit, admin-console-member-detail.

### What passed
- Unpaired and bad-token windows show the connect screen.
- Invite flow:
  - wrong code and mismatched email give the same error
  - client password rules work (length, number, symbol, not-email, confirm mismatch)
  - success signs in
  - reusing the invite gives 400
- Tour: 5 steps in order, replays from "?", does not come back on reload.
- Date ranges (Today / 7 / 30) work.
- Heatmap, top projects, insights and recent sessions render.
- Budget card, then the reached banner after the admin sets a $1 budget. "Ask for a higher budget" opens Support.
- Sessions: search (case-insensitive), tool filter, sort by cost and by length, detail panel, token split adds up to the total.
- Password change:
  - wrong current password gives an error
  - the emailed code works
  - the old password is rejected
  - the window session survives
- Backup email verified.
- Second device listed, and signing it out from the window revokes it (401).
- Force sync works. Sources panel shows "Reading normally" with correct file counts.
- While paused: no new event, nothing uploaded.
- Start at login toggles the real Run key off and on (value = the agent exe path).
- Appearance: System / Light / Dark work, and the top-bar toggle choice survives a reload.
- Support ticket stores diagnostics (with no prompt text). Without diagnostics it stores NULL.
- No prompt marker anywhere in agent data or the DB.
- Sign out. Wrong password gives an error.
- Forgot password works through the window, including "send to backup email" (mail went to the backup address). Wrong code gives an error.
- Removed screen after sync. It survives a reload, tracking stops, and the removal email was logged.

### Not verified, and why
- Real Wails shell and OS toast notifications: browser build only. `notify.Show` was not observed.
- Live `prefers-color-scheme` change while on "System": only the emulated light scheme was tested.
- axe at 390 px: not run (screenshots and overflow check only). Colour contrast needs a manual check (axe "incomplete").
- Weekly email and other admin-side alert delivery: outside member scope. Alert rows confirmed in `budget_alerts` only.
- **Registry:** the Run value at the start of my final run was `"…\prebuilt\aknologia-agent-windows-amd64.exe"`, written by another QA run. It is not the pre-QA value. The pre-QA value (my first check, and `registry-before.txt`) was `"C:\Users\Admin\AppData\Local\Temp\go-build1645114972\b001\exe\aknologia-agent.exe"`. My spec put back the start-of-run value (prebuilt). My attempt to set the go-build value was blocked by the permission system. **The lead must decide on the final value and set it.**
- The Vite dev server (:5174) is still running in the background. No agent process is left running.
