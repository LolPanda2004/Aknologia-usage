## 3. Admin console end-to-end

**Short version:** every admin flow works from start to finish, and every number on the overview matches the API and an independent calculation. I found 4 Major issues: the phone layout has no navigation, the tour breaks on phones, a rejected plan change still changes the plan, and changing a budget wipes the alert log. There are also 8 Minor issues and 6 Notes. No console errors appeared in any theme or viewport.

### How to run
1. Server running at http://localhost:8080 with `DEV_MODE=true`. Codes are read from `tests/.server.log`; if that file is missing, the helper falls back to `docker compose logs server`.
2. `cd tests/e2e && npx playwright install chromium`
3. `npx playwright test -c playwright.admin.config.ts`
4. `node summarize-admin.js` prints pass/fail per project and every finding, read from `test-results-admin/report.json`.

Files: `tests/e2e/admin.spec.ts`, `tests/e2e/admin-helpers.ts`, `tests/e2e/playwright.admin.config.ts`, `tests/e2e/summarize-admin.js`.

**What I ran:**
- **Full flow:** every admin flow through the UI, with API and DB cross-checks. 14 steps plus a findings check, run only in light-1440. Set `FULL_ALL=1` to run it in all four projects.
- **Pages pass:** run in all 4 theme × viewport combinations. It covers:
  - auth screens and signup
  - every tour step
  - every page, both empty and with data
  - every modal
  - full-page screenshots
  - console errors
  - horizontal overflow
  - overview numbers against the API

**How findings are counted:** product checks are recorded as findings (Playwright annotations) instead of stopping the run. Each suite ends with a `findings recorded in this suite` test, which fails if anything was recorded. So every failed test below is one of those findings tests, and the flow steps themselves all completed.

### Test counts (last run: 34 passed, 4 failed, 45 skipped)
| Project | Passed | Failed | Skipped |
|---|---|---|---|
| admin-light-1440 (full flow + pages pass) | 19 | 2 (both findings tests) | 0 |
| admin-dark-1440 | 5 | 1 (findings test) | 15 (full flow) |
| admin-light-390 | 5 | 1 (findings test) | 15 (full flow) |
| admin-dark-390 | 5 | 1 (findings test) | 15 (full flow) |

### Findings
| ID | Sev | Title | Repro | Expected | Actual | Suspected cause | Suggested fix |
|---|---|---|---|---|---|---|---|
| ADM-01 | Major | No navigation at phone width | Open the console at 390×844 | Some way to reach Members, Budgets, Support, Settings | Sidebar is `display:none`. There is no menu. Support and Settings can't be reached; Members and Budgets only through in-page buttons | `ui/shared/theme.css:184` (`.side { display:none }`) | Add a menu button with a drawer, or a bottom tab bar, under 860px |
| ADM-02 | Major | Tour gets stuck on phones at step 3 | 390 px, fresh org, tour step 3 "Your team at a glance" | Card readable, Next clickable | The highlighted KPI column (z-index 62) is taller than the screen and sits above the card (z-index 61). Next and Skip can't be clicked; a click lands on `div.card.kpi`. The only way out is tapping the dimmed area | `ui/shared/ui.tsx:252-263` (Tour placement), `theme.css:160-162` | Put the card above the target (z ≥ 63). Clamp the card into the viewport and skip or shrink tall targets |
| ADM-03 | Major | Tour step 5 points at a hidden element on phones | 390 px, tour step 5 | Points at Billing and support nav | `[data-tour=nav-account]` sits inside the hidden sidebar (0×0), so the card points at nothing | `ui/admin/main.tsx:71`, `ui.tsx:304` | Target a visible element on mobile, or skip steps whose target has no size |
| ADM-04 | Major | Rejected plan change still changes the plan | Settings → Change plan or seats → Starter, 9 seats → Save (or `POST /admin/billing/seats {seats:9, plan:'starter'}`) | 400 error and the plan stays the same | 400 "Starter plan includes up to 3 members", but the plan is now `starter`, with 9 seats on a 3-member plan. Verified via the API | `backend/internal/api/admin_handlers.go` `adminSetSeats`: `UPDATE orgs SET plan` runs before the Starter seat check | Validate everything first, then do one UPDATE in a transaction |
| ADM-05 | Major | Changing a member's budget erases the alert log | Member gets 80%/100% alerts → Members → Edit budget → Save → Budgets page | Alert log ("Every budget email and notification we sent") keeps the sent alerts | Alert log shows "No alerts yet"; this month's `budget_alerts` rows are deleted | `admin_handlers.go` `adminUpdateMember`: `DELETE FROM budget_alerts …` | Keep the log and reset only the de-duplication (e.g. include `budget_cents` in the uniqueness key or add a `reset_at` column) |
| ADM-06 | Minor | Signed-out sessions still listed after password change | Make a second session → Settings → Change password with code | Toast says other devices were signed out, and the list drops them | The session is revoked (old token gets 401) but the device still shows with a Sign out button | `auth_handlers.go` `changePasswordConfirm` (also `resetPassword`): sessions revoked, devices not | Also set `devices.revoked_at` for the revoked sessions' devices |
| ADM-07 | Minor | Sidebar plan card stays out of date | Change the plan to Team / 10 seats | Sidebar shows "TEAM PLAN · 10 seats" | Still "STARTER PLAN 3 seats" until reload | `ui/admin/main.tsx:140` (uses `me.org`, never reloaded) | Reload `/me` after billing or org saves (pass `loadMe` in ctx) |
| ADM-08 | Minor | Breadcrumb and overview subtitle keep the old org name | Settings → rename org → Save | Header shows the new name | Old name until reload | `main.tsx:116,135` | Same as ADM-07 |
| ADM-09 | Minor | "Send 1 invites" | Invite modal, type one email without pressing Enter | "Send 1 invite" | "Send 1 invites" | `ui/admin/pages/Members.tsx:112` (plural checks `emails.length`) | Use the same count for the number and the plural |
| ADM-10 | Minor | Alert log overflows at 390 px | Budgets page with alerts, 390 px | Fits the width | Page scrolls sideways; email and "Emailed …" text overlap. Evidence: `budgets-light-390.png` | `ui/admin/pages/Budgets.tsx:308` (fixed `150px 1fr 1fr` grid) | Stack the cells on narrow screens (flex-wrap or `minmax(0,1fr)` with wrap) |
| ADM-11 | Minor | Org form overwrites what you typed if it's still loading | Open Settings and type in Organization name straight away | Your typed value is kept | The `/admin/org` response arrives later and replaces the input; Save then stores the old name. Seen once in my runs | `ui/admin/pages/Settings.tsx:338` (useEffect sets name/tz on load) | Disable the fields until loaded, or only fill them when untouched |
| ADM-12 | Minor | Invited members never get a name | Invite → member accepts | A name is shown | Email is used everywhere; Remove button reads "Remove and email qa3-m2-…@example.test" | `auth_handlers.go` `acceptInvite` (no name field), `Members.tsx:137` | Ask for a name when accepting, or use the email's local part in the copy |
| ADM-13 | Minor (code review, not tested) | Password checklist passes passwords the server rejects | Signup or reset with a password containing your name (≥4 chars) | Checklist flags it | Checklist shows all green, then the server says "Don't include your email or name" | `ui/shared/format.ts` `passwordRules` vs `backend/internal/auth/auth.go:98` | Pass the name to the checklist |
| ADM-14 | Note | Team spend vs member rows | Remove a member and keep history (and/or re-invite them) | Totals add up visibly | Team spend still includes the removed member's spend, but no row shows it. A re-invited member shows old spend. Total vs rows differs by 1¢ ($57.37 vs $57.38, rounding) | `admin_handlers.go` `adminOverview` | Add a "Removed members" line, or explain this in the tooltip |
| ADM-15 | Note | "Spend this month" chart has no empty state | Fresh org overview | "No usage yet" | Empty chart with a rising dashed budget-pace line | `ui/admin/pages/Overview.tsx:344-346` | Show `<Empty>` when spend is 0 |
| ADM-16 | Note | CSV filename ignores the server's | Settings → Export CSV | `aknologia-usage-<from>-to-<to>.csv` | `aknologia-usage.csv` | `ui/admin/api.ts:33-42` (hard-coded name) | Read the `Content-Disposition` header |
| ADM-17 | Note | Budget changes behave differently in two places | Change a budget on the Budgets page vs Members → Edit budget | Same behaviour | PATCH resets this month's alerts; PUT `/admin/budgets` does not | `admin_handlers.go` `adminUpdateBudgets` vs `adminUpdateMember` | Pick one rule, after fixing ADM-05 |
| ADM-18 | Note (code review, not tested) | Invite link email not URL-encoded | Invite `a+b@x.com` | Accept form pre-fills the email | `+` turns into a space | `admin_handlers.go` `sendInvite` (`"#/accept?email="+email`) | `url.QueryEscape(email)` |
| ADM-19 | Minor | Tour highlight for steps 4 and 5 is dimmed on desktop | 1440 px, tour steps 4 (help/theme) and 5 (nav) | Target highlighted above the dim layer | The target is under the dim layer (`elementFromPoint` hits `div.tour-dim`). The sticky `.topbar` (z-index 10) and sticky `.side` create their own stacking contexts | `theme.css:119,129,162` | Raise the stacking context of the highlighted ancestor while the tour runs, or draw the highlight as a separate overlay box |

Evidence for each finding: `tests/e2e/test-results-admin/report.json` (annotations of type `finding`), `tests/e2e/test-run-admin.log`, the `notes-*.json` files in `test-results-admin/`, and the screenshots below. **Console errors: none** in any project, apart from the blocked third-party fonts the brief allows.

### Screenshots (144 files, `tests/e2e/screenshots/admin/<page>-<theme>-<width>.png`)
- **Pages pass (all 4 projects):**
  - auth: signin, accept, forgot, signup, verify, reset-code, reset-newpw
  - tour-1 to tour-5
  - empty org: overview-empty, members-empty, member-empty, budgets-empty, support-empty
  - settings: settings, settings-data
  - with data: overview, members, member, budgets, support
  - modals: invite-modal, budget-modal, remove-modal, plan-modal, password-modal, delete-modal
- **Full flow (light-1440 only):**
  - flow-signup, flow-tour-1 to flow-tour-5
  - flow-overview-empty, flow-plan-modal, flow-invite-modal, flow-members-invited
  - flow-overview, flow-member, flow-budget-modal, flow-remove-modal, flow-members-removed
  - flow-budgets-edited, flow-budgets
  - flow-password-modal, flow-settings-backup, flow-settings, flow-delete-modal, flow-overview-after-delete
  - flow-support, flow-signin-after-reset

### What passed
- **Sign up:** the 6-digit code from the log works, and the address is masked on screen.
- **Tour:** all 5 steps exist with correct content. Replay from the help icon works, and the tour is not shown again on the same browser.
- **Theme:** the toggle switches and the choice survives a reload. Both themes render with the right `data-theme`.
- **Fresh org:** empty states render ("Not enough data yet", "No usage yet", "No activity yet", "No alerts yet", "No requests yet", "No devices", "No invoices yet."), and every overview number matches the API.
- **Plan and seats:** the change saves (Team, 10 seats, $90/month).
- **Invites:**
  - The email field turns entries into chips on Enter, comma or space; pasting a list works; one chip can be removed.
  - Entries are lower-cased and de-duplicated, and anything without an @ is dropped.
  - The budget field accepts only numbers.
  - The seats-left hint is correct, and the role can be Member or Admin.
  - Seat and pending-invite KPIs update.
- **Resend and cancel:** resend issues a new code and the old one stops working. Cancel removes the invite and frees the seat.
- **Usage data:** members accepted with a desktop client; ingest works and a resent batch is de-duplicated. Refresh data reports the right event count (44, later 42).
- **Overview numbers vs API vs independent pricing math:**
  - Spend $57.39, saved $23.80, active 1.4 h, cache 93%, $41.99 per active hour.
  - 229% of budget, Over budget status, Claude/Codex share.
  - Budget health, alert banner, member rows, model shares and data health all match.
  - "Last month" correctly shows $0.
- **Member detail:** KPIs, budget card, alerts, device, and 2 sessions all match the API, and the % matches the overview.
- **Edit budget and removals:**
  - Edit budget works.
  - Removing a member without history keeps 4 events in the DB, and their device gets 403.
  - Removing with history deletes the events and daily rows (DB checked).
  - The Removed filter and re-invite work.
- **Budgets:** default, per-member override, clearing an override, inbox add (Enter and button) and remove, toggles, and save all work and persist after reload (checked via the API). The alert log refills after a refresh.
- **Settings:**
  - Org name and time zone save.
  - Password change with code works: other sessions get 401 and the old password is rejected.
  - Device sign-out works (its token gets 401).
  - Backup email add, verify with code, and remove all work.
  - Refresh now works.
  - CSV download: header correct, rows equal `daily_usage`, cost total matches.
  - Delete data with code empties the DB, and the overview returns to empty states.
- **Support:** feature and bug tickets work; severity, start date and diagnostics are stored.
- **Sign out, reset, sign in:** sign out revokes the token. Forgot password, code, mismatch warning, new password and sign-in with it all work; the old password is rejected.
- **Layout:** no horizontal overflow on any page or modal, except Budgets at 390 px (ADM-10).

### Not verified, and why
- The full functional flow ran in light-1440 only; the other 3 projects ran the pages, screenshot, console and layout pass. Use `FULL_ALL=1` to run the full flow everywhere.
- Real email delivery: DEV_MODE prints codes to the log and no SMTP was used.
- Reset via "Send to backup email instead".
- Rate limiting: it is off in DEV_MODE.
- Weekly summary email and card payments: not built.
- axe/accessibility and keyboard-only navigation, other browsers, and the landing-page links.
- ADM-13 and ADM-18 come from reading the code and were not run.
- "Ask for a code on new devices" toggle: not exercised.
