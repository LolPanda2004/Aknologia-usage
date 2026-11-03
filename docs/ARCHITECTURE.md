# Architecture

## Flow of one AI turn

1. Claude Code or Codex appends a line to its session file on the developer's laptop.
2. The **agent** (polling every 20 s) reads only new, complete lines, from the saved byte offset.
3. A **parser** extracts whitelisted fields: tool, session ID, message/request ID, model, input/output/cache tokens,
   timestamp, working folder. Prompts, replies, tool output, and file contents are never copied.
4. The event is appended to `events.jsonl` (deduplicated by tool + session + message + request ID). The desktop
   window reads summaries from the agent immediately, even offline.
5. At the hourly window (minute `SYNC_MINUTE` + 0–120 s of per-device jitter), or on **Force sync**, the agent sends
   pending events in batches of 500. The working folder is replaced by `HMAC-SHA256(org salt, folder)[:16]`.
6. The server identifies the member from the device token (never from the payload), prices each request at list
   price (`model_prices`, micro-dollars; see PRICING.md) and upserts it: a resent event may only grow (a streamed
   reply's final output, billing details an older agent missed), never lower its cost. It recomputes that member's
   `daily_usage` from the oldest changed day (org-local days), and
   evaluates budgets: each 80% / 100% alert is sent once per member per month per budget amount (email to alert
   inboxes, notification to the member's desktop). Budgets are also checked right after an admin changes one.
7. The admin console reads aggregates from `daily_usage` and `usage_events`.

## Accounts and security

* **Workspaces** are created by self sign-up (email verified with a 6-digit code). The creator is the first admin.
* **Members** join only by invitation: an 8-character invite code (14 days, single use) plus a password they choose.
* **Passwords:** PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte salt. Rules: 12+ characters, a number, a symbol,
  not containing the email name.
* **One-time codes** (signup, reset, password change, backup email, data deletion): 6 digits, stored hashed,
  10 minutes, single use, burned after 5 wrong attempts. Auth endpoints are rate limited per IP.
* **Sessions:** random 256-bit bearer tokens stored as SHA-256 hashes. Desktop sessions last 180 days, web 14 days.
  Password change or reset revokes other sessions. Removal revokes all of a member's sessions and devices.
* **Desktop window ↔ agent:** the agent listens on `127.0.0.1:47811` and requires the token in
  `<data dir>/agent.token` (mode 0600). The window never sees the device's server token; account calls go through
  the agent's proxy.

## Server API (all under `/api/v1`)

| Area | Endpoints |
|---|---|
| Public | `POST auth/signup`, `auth/verify-email`, `auth/login`, `auth/invite/accept`, `auth/password/forgot`, `auth/password/reset`, `demo-requests`; `GET health` |
| Signed in | `GET me`, `PATCH me/settings`, `POST me/password/start` + `confirm`, `POST/DELETE me/backup-email`, `POST me/backup-email/verify`, `GET me/devices`, `DELETE me/devices/{id}`, `GET me/usage`, `GET me/notifications`, `POST me/notifications/{id}/read`, `GET agent/config`, `POST ingest/batch`, `GET/POST support/tickets`, `POST auth/logout` |
| Admin | `GET admin/overview`, `GET admin/members`, `POST admin/members/invite`, `POST admin/members/{id}/resend`, `PATCH/DELETE admin/members/{id}`, `GET admin/members/{id}/usage`, `GET/PUT admin/budgets`, `GET/PUT admin/org`, `GET admin/billing`, `POST admin/billing/seats`, `POST admin/refresh`, `GET admin/export.csv`, `POST admin/data/delete/start` + `confirm`, `GET admin/pricing` |

## Agent local API (all under `http://127.0.0.1:47811/v1`, header `X-Agent-Token`)

`GET status`, `POST auth/login`, `POST auth/accept-invite`, `POST auth/forgot`, `POST auth/reset`,
`POST auth/logout`, `GET summary?days=`, `GET sessions?days=`, `POST sync`, `PUT prefs`, `PUT server`, and
`/server/*` (proxy to `me`, `support/tickets`, `agent/config`).

## Definitions shown in the UI

* **Spend:** each request priced at the vendor's list price the way the API bills it (cache write 5 min / 1 h,
  cache read, long-context tier, fast mode, US-only inference, web searches). An API-equivalent measure, not an invoice.
* **Active coding time:** within each session, gaps between consecutive turns of 5 minutes or less are summed; a
  turn after a longer gap counts 30 seconds.
* **Saved by caching:** cache-read tokens × (input price − cache-read price), minus the extra paid for cache writes.
* **Cost per active hour:** spend ÷ active hours.

## Database tables

`orgs`, `users`, `invites`, `devices`, `sessions`, `otps`, `usage_events` (raw, primary key = dedup key),
`daily_usage` (rollup), `model_prices`, `budget_alerts`, `notifications`, `tickets`, `invoices`, `demo_requests`,
`schema_migrations`.

## Migrations

`backend/internal/db/migrations/*.sql`, applied in name order at start (or with `-migrate`) under a Postgres advisory
lock, one transaction each, recorded in `schema_migrations`: `001_init.sql` (schema), `002_exact_pricing.sql`
(per-request billing fields and cost, `model_prices`), `003_alerts_per_budget.sql` (alert key includes the budget
amount). Never edit an applied migration; add a new file.

## Related docs

`PARSERS.md` (session formats), `PRICING.md` (price engine), `SECURITY.md`, `DESIGN.md` (UI system),
`TESTING.md`, `STATUS.md` (done and open items), `DEPLOY.md`, and `CLAUDE.md` at the repository root.

## Not built yet

* Card payments (plans, seats, and invoices are stored; connect a payment provider to charge).
* The weekly summary email (the setting is stored; it needs a scheduled job).
* Automatic deletion of raw events after 90 days (run `DELETE FROM usage_events WHERE ts < now() - interval '90 days'`
  on a schedule, for example a Neon scheduled query or a cron job).
* Agent auto-update (publish new builds on `/download/`; the admin console flags outdated versions).
