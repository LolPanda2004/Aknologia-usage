# Security model

## Accounts and secrets

- **Passwords:** PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte salt. Rules: 12+ characters, a number, a symbol,
  not containing the email name (`backend/internal/auth`, mirrored for display in `ui/shared/format.ts`).
- **Sessions:** random 256-bit bearer tokens, stored as SHA-256 hashes. Desktop 180 days, web 14 days. Only the
  `Bearer` scheme is accepted. Password change revokes the other sessions and their devices; reset revokes all.
  Removal revokes all sessions and devices; a removed member's password hash is kept only so a correct sign-in can
  say "you were removed" (status blocks access); re-invite clears it.
- **One-time codes** (signup, reset, password change, backup email, data deletion): 6 digits, hashed, 10 minutes,
  single use. Each guess takes one of 5 attempts atomically before comparing, so parallel guesses can't exceed it.
- **Invites:** 8-character code, hashed, 14 days, single use; resend invalidates the previous code.
- **Login responses** reveal account state (removed, unverified) only after the password matches; a wrong password
  always gets the same 401 message.
- No response ever contains `password_hash`, `code_hash` or `token_hash`; the database stores no plaintext
  password, token or code (checked with `pg_dump` in `tests/api/run.mjs`).

## Requests

- **Rate limit:** 20 auth requests per IP per 10 minutes (off in dev mode). The key is the socket address;
  `X-Forwarded-For` is used only when `TRUSTED_PROXY_HOPS` > 0, and then only the entry appended by the outermost
  trusted proxy (Render: 1). A client can't pick its own key.
- **CORS:** exact `PUBLIC_URL` plus `CORS_ORIGINS`; `http://localhost[:port]` and `http://127.0.0.1[:port]` only in
  dev mode (the desktop window talks to the agent, not the server). `X-Content-Type-Options: nosniff`.
- **Authorization:** members get 403 on every `/admin` route; admins only see their own org (404 for others);
  ingest attributes events to the token's user only.
- **Ingest:** at most 2000 events per batch; timestamps from 2 years ago to 1 hour ahead; tokens 0–100M per field;
  web searches 0–10,000. A resent event may only grow (see CLAUDE.md), so recorded spend can't be lowered.
- **CSV export:** dates validated (400 on a bad date); cells starting with `= + - @`, tab or CR are prefixed with `'`
  so spreadsheets don't run them as formulas.

## Email

Dev mode without SMTP prints messages (including codes) to the log; **never run production in dev mode**. Outside
dev mode with no `SMTP_HOST`, sending fails with 503 `email_not_configured`, the log says only that an email wasn't
sent (no subject or recipient), and the server warns at start.

## Desktop agent

- Local API on `127.0.0.1:47811`, requires the token in `<data dir>/agent.token`; foreign `Origin`s are rejected.
  (Known hardening item: the origin check is a prefix match, AG-03.)
- Prompts, code and file names never leave the laptop; folders are HMAC-hashed with a per-org salt before sync.
- Data dir defaults to `%APPDATA%\Aknologia` on Windows; the device token is plain text protected by folder ACLs
  (AG-14).

## Data deletion

Deleting org data requires a code emailed to the admin. Removing a member with `deleteHistory=true` deletes their
usage; otherwise it is kept and still counted in team totals. Raw events have no automatic 90-day expiry yet.
