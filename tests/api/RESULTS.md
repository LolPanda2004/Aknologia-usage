## 1. API and security

### How to run

All test code is in `tests/api` (Node 20+, no dependencies). It uses `docker compose exec -T db psql` for DB checks and reads codes from `tests/.server.log`.

1. Main suite, against the shared dev server: `node tests/api/run.mjs` (to run a subset: `ONLY=<regex> node tests/api/run.mjs`). The output goes to `tests/api/run-output.txt` and `tests/api/last-run.json`.
2. Rate-limit suite (needs its own server with `DEV_MODE=false`):
   1. `docker run -d --name akn-qa1-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=aknologia -p 55431:5432 postgres:16-alpine`
   2. `cd backend && go build -o ../tests/api/.bin/akn-server.exe ./cmd/server`
   3. `cd tests/api && PORT=8091 DEV_MODE=false DATABASE_URL='postgres://postgres:postgres@localhost:55431/aknologia?sslmode=disable' ./.bin/akn-server.exe > .server-8091.log 2>&1 &`
   4. `BASE=http://localhost:8091 LOGFILE=tests/api/.server-8091.log DB_CONTAINER=akn-qa1-db node tests/api/ratelimit.mjs`
   5. Afterwards, stop the server and run `docker rm -f akn-qa1-db`.
3. `scripts/e2e.sh`: `PATH=<dir with a python3 -> python shim>:$PATH LOG=tests/.server.log BASE=http://localhost:8080 bash scripts/e2e.sh`. On this machine `python3` is the Microsoft Store stub, so a shim is needed. The script uses fixed emails, so it only runs once per fresh DB. Output is in `tests/api/e2e-output.txt`.

### Results

| Suite | Result |
|---|---|
| `scripts/e2e.sh` (fresh DB) | **ALL_PASSED** (exit 0). Its numbers check out by hand: $153.21 = 120 × $1.275 (opus) + 10 × $0.02075 (codex). |
| `run.mjs` (47 tests, 295 checks) | **34 passed, 13 failed** (274 of 295 checks pass). The OTP race test is timing-dependent: it failed in 7 of 9 runs (6 to 10 guesses got through) and is counted as a failure. |
| `ratelimit.mjs` (3 tests) | **1 passed, 2 failed** |

Every failing test is a product finding listed below. No failures come from bugs in the tests.

### Findings

| ID | Sev | Title | Repro | Expected | Actual | Suspected cause | Suggested fix |
|---|---|---|---|---|---|---|---|
| API-01 | **Blocker** | Orgs west of UTC (e.g. America/New_York): new usage silently stops appearing in totals | 1. Org tz `America/New_York`, one member. 2. Ingest an event at `<UTC date of now-40d>T01:00Z` (local: the previous day). 3. Ingest a $1.50 event now, then another $0.75. 4. `GET admin/members/{id}/usage`. | Spend 2.25. | Both ingests return `200 {"accepted":1}`, but spend stays **0** and `daily_usage` has no rows for today. The log shows `rollup: pq: duplicate key value violates unique constraint "daily_usage_pkey"` on every ingest that day. Budget alerts can't fire either, since they read the same totals (inferred, not run). `POST admin/refresh` fixes it until it happens again. | `usage.go:24-31`: the DELETE uses `day >= since::date` (a day in org time), but the re-insert selects `e.ts >= since::date`, which is midnight **UTC**. Events in the gap belong to an org-local day that was never deleted, so the INSERT hits the PK and the whole rollup transaction rolls back. Called from `ingest.go:124`. | Make both bounds the same org-local day: delete `day >= d` and select `(e.ts AT TIME ZONE o.timezone)::date >= d`, with `d` computed in the org's time zone. Or use `INSERT … ON CONFLICT DO UPDATE`. Add a test. |
| API-02 | **Blocker** | Orgs east of UTC (e.g. Asia/Kolkata): events early on the oldest day of the window are dropped from totals | Org tz `Asia/Kolkata`. Ingest an event at `<now-40d date>T00:00Z - 1h` (04:30 IST on that date). | That day's `daily_usage` and export show $0.75. | Accepted, but it is in neither `daily_usage` nor the CSV (0 micros). Each later ingest deletes that day again and rebuilds it without these events. | Same lines as API-01 (`usage.go:25` vs `:31`). | Same fix as API-01. |
| API-03 | **Major** | Events older than 40 days are accepted but never counted until an admin presses Refresh | Ingest an event at now-60d, then `GET admin/overview?month=<that month>`. | spend 0.75 | spend **0** (it becomes 0.75 only after `POST admin/refresh`). This hits first installs that backfill history and laptops offline for more than 40 days. | `ingest.go:97` accepts events up to 2 years old, but `ingest.go:124` rolls up only 40 days. | Roll up from `min(ts)` of the accepted batch, or match the accepted age to the rollup window. |
| API-04 | **Major** | One member can freeze their own numbers and break **Refresh data** for the whole org | A member ingests 2 events with `input: 5e18` (same day and model), then a normal $0.75 event. Admin presses `POST admin/refresh`. | Absurd counts rejected (400 or `rejected`), totals keep updating. | `{"accepted":2}`. From then on that member's `daily_usage` never changes, and `POST admin/refresh` returns **500** for the whole org. Log: `Scan error … sum … ("10000000000000000000") to a int64: value out of range`. A member could hide spend from the admin this way. | `ingest.go:99-100` has no upper bound. The bigint `sum()` is numeric, and `usage.go:44` scans it into int64. | Reject per-event tokens above a sane cap (e.g. >10M), and `LEAST`/clamp in SQL. Don't let one user's rollup failure abort the org refresh. |
| API-05 | **Major** | Auth rate limit is bypassed with a spoofed `X-Forwarded-For` | DEV_MODE=false server: 21 logins from one IP → 21st is 429 (good). Then send 30 logins, each with `X-Forwarded-For: 10.9.<i>.1`. | 429 | All **401**: the limit never triggers. With 5 guesses per code (or 10, see API-07) and unlimited `password/forgot`, codes and passwords can be brute-forced. | `server.go:195-198` trusts the first, client-supplied XFF value. | Use `r.RemoteAddr` unless a trusted-proxy setting is on. Behind Render, take the **last** hop the proxy appended. Also limit per email/account. |
| API-06 | **Major** | Changing a member's budget via `PUT admin/budgets` does not reset alerts (only PATCH does) | Member budget $10 → spend $8.25 (80% alert sent). `PUT admin/budgets {"members":{"<id>":20}}`. Spend to $17.25 (86% of $20). | A fresh 80% alert for the $20 budget (the docs say "changing a member's budget resets this month's alerts"). | `budget_alerts` still holds only the old `80 / 1000` row. No alert for the new budget. Changing `defaultBudget` doesn't reset either (code review, not run). | `admin_handlers.go:684-691` (no `DELETE FROM budget_alerts`). Compare `admin_handlers.go:420`. | Share the reset logic for both paths and for default-budget changes. |
| API-07 | Minor | 5-attempt OTP limit can be exceeded with parallel guesses | Send 40 parallel wrong `verify-email` codes for one signup, then read `otps.attempts`. | attempts ≤ 5 | 7, 6, 8, 6, 10, 7, 6 across runs. Up to 10 guesses get compared. | `auth_handlers.go:67-79`: read-check-increment is not atomic. | Use one statement: `UPDATE otps SET attempts = attempts+1 WHERE id=$1 AND attempts < 5 RETURNING …` before comparing, or `SELECT … FOR UPDATE`. |
| API-08 | Minor | CORS allows look-alike origins | `GET /api/v1/health` with `Origin: http://localhost.evil.example` (also `http://127.0.0.1.evil.example`, and in prod `https://<PUBLIC_URL>.evil.com`). | No `Access-Control-Allow-Origin` | ACAO echoes the evil origin. The impact is limited because auth is a bearer header, not a cookie. Unknown origins like `https://evil.example` are correctly refused. | `server.go:155` uses `HasPrefix`. | Compare exact origins: parse the URL and match scheme+host (+port) against an allow-list. Allow localhost only in DEV_MODE. |
| API-09 | Minor | CSV export allows formula injection | A member sets their name via `PATCH me/settings {"name":"=HYPERLINK(\"http://evil.example\",\"click\")"}` and ingests. The admin downloads `admin/export.csv`. | The cell is neutralised (e.g. prefixed with `'`) | `…,"=HYPERLINK(""http://evil.example"",""click"")",…` | `admin_handlers.go:837` | Prefix cells starting with `= + - @ \t \r` with `'`. |
| API-10 | Minor | Invalid export date gives 500 | `GET admin/export.csv?from=notadate` | 400 invalid | `500 server_error`. Log: `invalid input syntax for type date` | `admin_handlers.go:814-822` | Parse `from`/`to` with `time.Parse("2006-01-02")` and return 400. |
| API-11 | Minor | A rejected Starter downgrade still changes the plan | Org on team/10 seats: `POST admin/billing/seats {"seats":10,"plan":"starter"}` | 400 and nothing changed | 400, but `GET admin/billing` shows `plan: starter, seats: 10`. | `admin_handlers.go:778-784`: the plan is updated before the Starter check. | Validate first, then update plan and seats in one statement. |
| API-12 | Minor | Re-inviting an already-pending invite at full seats gives 402 | Starter org (3 seats): invite 2 people (3/3 used), then invite one of them again. | 200 (no new seat used) | `402 seats` "You have 0 of 3 seats left". It also blocks re-inviting a removed member when the org is full, and miscounts duplicate emails in one request. | `admin_handlers.go:336-346` counts every email as new. | Count only emails that would add a new active/invited user. De-duplicate the list. |
| API-13 | Minor | Events up to 24 h in the future are accepted | Ingest an event at now+23h. | Rejected (or clamped to a few minutes of skew) | `accepted:1`. It counts toward today's spend and budgets. | `ingest.go:97` | Use a small skew limit (e.g. +10 min). |
| API-14 | Minor | Login reveals account state without the right password | `POST auth/login` with a wrong password for a removed account, and for an invited account. | 401 bad_credentials (same as any wrong login) | `403 removed` / `403 invited`. This lets someone list removed and pending accounts. | `auth_handlers.go:247-255` | Check the password first. Return `removed`/`invited` only after it matches, or always return 401. |
| API-15 | Minor | Without SMTP, a production server (DEV_MODE=false) writes one-time codes to its log | DEV_MODE=false, no `SMTP_HOST`: sign up. | Start-up fails, or the send fails loudly | Signup returns 200, and the log has `[mail] to=… subject="Your Aknologia code: 125708"`. | `mail.go:28` (`s.Host == ""` → log). `main.go:44`. | When `!DevMode && SMTPHost == ""`, refuse to start or return an error from `Send`. |
| API-16 | Note | Bearer scheme not enforced | `Authorization: <raw token>` (no `Bearer `) | 401 | 200 | `server.go:108` (`TrimPrefix`) | Require the `Bearer ` prefix. |
| API-17 | Note | PATCH alert reset uses the DB's UTC month, not the org's | Code review only, not run (needs clock control): an IST org changes a budget between 00:00 and 05:30 IST on the 1st. | That month's alerts are reset | It deletes alerts for the *previous* month instead. | `admin_handlers.go:420` `date_trunc('month', now())` | Use `monthRange(orgTZ).From` as `evaluateBudget` does. |

### What passed

- **Auth**
  - Signup → verify → login works.
  - Duplicate signup returns 409, also for upper-case or padded email.
  - All password rules are enforced with the right messages: under 12 characters, no number, no symbol, contains the email name (any case), contains the name. They are also checked on invite accept and on reset.
  - A member logging in with `client: web` or no client gets `403 not_admin`. Desktop login works.
  - Wrong password and unknown email both return `401 bad_credentials`.
- **One-time codes**
  - Wrong, expired, burned (5 sequential wrong attempts) and reused codes are rejected.
  - The reset code is mailed to the verified backup inbox. Its code-only check works, the reset revokes old sessions, the old password stops working, and the code can't be reused.
  - `password/forgot` for an unknown email returns the same 200.
  - Change-password needs the current password plus a code, and revokes the other sessions.
  - The rate limit of 20 requests per 10 minutes is shared across auth endpoints, and health is not limited.
- **Invites**
  - The seat limit returns 402, and cancelling an invite frees the seat.
  - A cancelled code is dead. Resending invalidates the old code, and the new code works when typed loosely. A used code is rejected.
  - Expired invites are rejected. Invites last 14 days.
  - A code paired with the wrong email is rejected.
  - A removed member can be re-invited. Their old password and old token stay dead, and the new password works.
  - Inviting an email from another org returns `belongs_to_another_org`.
- **Authorization**
  - A member gets `403 forbidden` on all 18 admin routes, and nothing changes.
  - Admin A gets 404 on org B's member usage, PATCH, DELETE, resend and cancel. A `PUT budgets` with B's id does not change B.
  - Overview, members, budgets, export and org responses contain no B data.
  - A member can't mark another user's notification read or revoke another user's device.
  - Revoked device, logged-out token and expired token all return 401.
  - Desktop sessions last 180 days and web sessions 14 days.
  - A removed member gets `403 removed` on `/me`, `/agent/config`, ingest and `/me/usage`. All their sessions and devices are revoked. An admin can't remove themselves.
- **Ingest**
  - Sending the same batch twice is idempotent: 3/0/0, then 0/3/0, with 3 rows in the DB.
  - Truncated JSON, a non-array `events` and string token counts return 400.
  - Bad tool, empty session, empty message, missing ts and negative token counts are counted as `rejected`.
  - 2001 events return 400. 2000 are accepted.
  - Events 3 years old, 2 days in the future, and at the epoch are rejected.
  - A `userId` / `user_id` / `deviceId` in the payload is ignored. Events go to the token's user only.
- **Money and time**
  - `GET admin/pricing` matches the DB table.
  - An 8-event batch covering opus, sonnet (mixed case), haiku, gpt-5-codex, gpt-4.1, an unknown model and an empty model was costed by hand at **$5.74** (5,737,724 micro-$), with $1.32 saved by caching. It matches to the cent in overview spend, the overview member row, member usage, `/me/usage`, `budget.spentCents`, each CSV row (4 decimals), the CSV sum and the per-model breakdown.
  - The active-time rule is exact: 4229 s for crafted gaps of 1 min, exactly 5:00 (counted), 6:30 (30 s), 4:59, and a first turn (30 s). It matches activeHours, the per-session minutes and `/me/usage`.
  - The IST month boundary is right: an event at 18:29Z on the last day lands in the previous month, and one at 18:31Z in the current month. This holds in overview, member usage, `agent/config` budget, the CSV day rows and `dailyActive`.
- **Budgets**
  - The 80% and 100% alerts are sent exactly once each, both in `budget_alerts` and `notifications`, with one email per threshold to the configured inboxes (normalised). There are no repeats after more usage or after Refresh.
  - PATCH on a member's budget resets alerts, and they are re-sent against the new budget.
  - The `alert_80` and `alert_100` toggles are respected. With no inboxes, alerts go to the admins.
- **Deletion**
  - Data deletion needs the emailed code (a wrong code or a missing start is rejected). It deletes only this org's events and rollups.
  - `deleteHistory=true` deletes usage. Without it, usage is kept and the removal email is sent.
- **Headers and secrets**
  - `nosniff` is set on API, health and `/app/`. Unknown origins get no ACAO.
  - Every `password_hash` is `pbkdf2_sha256$600000$<16-byte salt>$<32-byte hash>`. Session, OTP and invite hashes are all 64-hex SHA-256.
  - None of the plaintext passwords, tokens and invite codes used in the run appear in a `pg_dump`.
  - None of the API responses collected during the run contains `password_hash`, `code_hash`, `token_hash` or `pbkdf2`.

### Not verified, and why

- **API-17 (UTC month in the PATCH reset):** found in code only. A real test needs control of the server clock on the 1st of a month.
- **Rate limits on endpoints other than login and signup:** not tested one by one. They use the same `s.limit` wrapper.
- **Real email delivery:** not tested. I used no real SMTP, and the emails were checked through the `[mail]` log lines only.
- **`email_member_at_100` and the weekly summary:** not tested. The weekly summary is not built yet.
- **Agent local API (`127.0.0.1:47811`):** not tested. It is out of scope for the server API.
- **Natural session expiry:** simulated by setting `sessions.expires_at` in the DB.
- **Removal while an agent is mid-sync:** not tested.
- **`demo-requests` and `support/tickets`:** covered only by e2e.sh.
