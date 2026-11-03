# CLAUDE.md

Guide for working on **Aknologia Usage** with Claude Code. Read this first, then the doc for the area you touch.

## What it is

Usage tracking for teams on Claude Code and Codex. A desktop **agent** on each laptop reads the CLIs' local
session files, keeps only usage numbers (tokens, model, timestamps, folder hash), and syncs them hourly to a
**server**. Admins use a web **admin console**; members see their own numbers in a **desktop window**. Spend is the
API-equivalent cost at vendor list prices (most teams use subscriptions, so there is no per-token invoice).

## Repository map

| Path | What | Notes |
|---|---|---|
| `backend/` | Go server: `/api/v1`, admin console at `/app/`, landing at `/`, installers at `/download/` | Postgres via `lib/pq` only |
| `backend/internal/api` | HTTP handlers: `auth_handlers.go`, `admin_handlers.go`, `ingest.go`, `usage.go` (rollups, totals, sessions), `server.go` (routes, middleware) | |
| `backend/internal/pricing` | Price engine (`engine.go`), price list (`catalog.json`), DB loader (`pricing.go`), golden tests | `engine.go` + `catalog.json` are copied byte-for-byte into `agent/internal/pricing` |
| `backend/internal/db/migrations` | `001_init.sql`, `002_exact_pricing.sql`, `003_alerts_per_budget.sql` | Append-only; applied at start under an advisory lock |
| `agent/` | Go agent, **standard library only**: scan → parse → store → sync, local API on `127.0.0.1:47811` | |
| `agent/internal/{parse,scan,store,syncer,localapi,pricing,paths,autostart,notify}` | | see docs/ARCHITECTURE.md |
| `ui/` | React 18 + TS + Vite. `ui/admin` (console), `ui/desktop` (window), `ui/shared` (design system) | No new runtime deps without asking |
| `desktop/` | Wails v2 shell for the desktop window (min 960×640) | |
| `landing/` | Static marketing page + `/download/` page | Inline styles + small script |
| `scripts/` | `e2e.sh` (API flow), `build-desktop.sh` (installers) | Bash |
| `tests/` | All test suites and QA tooling; see docs/TESTING.md | |
| `docs/` | `ARCHITECTURE`, `DEPLOY`, `PARSERS`, `PRICING`, `DESIGN`, `TESTING`, `SECURITY`, `STATUS` | |

## Commands

Bash (Git Bash on Windows):

```bash
docker compose up --build -d                          # Postgres + server on :8080 (DEV_MODE=true: codes printed to the log)
cd ui && npm install && npm run build                 # admin + desktop bundles (admin → ui/dist/admin, desktop → desktop/frontend/dist)
cd ui && npm run typecheck                            # must stay clean
cd ui && npm run dev:admin                            # :5173, proxies /api to :8080
cd ui && npm run dev:desktop                          # :5174, open /?token=<agent.token>
cd backend && go vet ./... && go test ./...
cd agent && go vet ./... && go test ./...
cd backend && DEV_MODE=true go run ./cmd/server       # server without Docker (needs Postgres)
cd backend && go run ./cmd/server -migrate            # apply migrations and exit
cd agent && go run ./cmd/aknologia-agent -scan-once   # parse local files once and print counts
```

PowerShell equivalents: set env with `$env:DEV_MODE='true'; go run ./cmd/server`; chain with `;`. `make` is not
installed on Windows; the Makefile targets are plain commands you can copy.

The server serves the admin bundle **baked into the Docker image**: after UI changes run
`docker compose up -d --build server` to see them on :8080.

## Rules that keep the product correct

- **Privacy:** the agent never copies prompt, reply, tool or file text. Parsers read a whitelist of fields. The
  working folder stays on the laptop; only `HMAC-SHA256(org salt, folder)[:16]` is synced. Tests grep for marker
  strings; keep it that way.
- **Pricing is exact, per request:** never add substring matching or a default price. Unknown models are
  *unpriced* (cost NULL, listed in Data health). Prices come from the official pages; see docs/PRICING.md. When
  you change `backend/internal/pricing/engine.go` or `catalog.json`, copy them to `agent/internal/pricing/` (a test
  fails if they differ) and add a golden case in `testdata/golden.json` worked out by hand.
- **Ingest is monotonic:** a resent event may only grow (no token count down, same model, speed/geo only filled
  in). This stops a member from lowering recorded spend. Keep the agent's `store.supersedes` and the SQL `WHERE` in
  `ingestBatch` in step.
- **Rollups use org-local days:** `rollup()` deletes and rebuilds `daily_usage` from the same org-local cut-off.
  Totals add stored per-request `cost_micros`; never re-price aggregates.
- **Budget alerts:** one 80% and one 100% alert per member per month *per budget amount* (`budget_alerts` key
  includes `budget_cents`). Never delete alert history to "reset" alerts.
- **Migrations:** add a new numbered file; never edit an applied one. Startup work that writes shared rows must
  take an advisory lock (two instances can start at once).
- **Security defaults:** `Bearer` scheme required; CORS exact-match (`localhost` only in dev); rate-limit key
  ignores `X-Forwarded-For` unless `TRUSTED_PROXY_HOPS` > 0; outside dev mode mail without SMTP fails (503) and
  nothing sensitive is logged. Login reveals account state only after a correct password. See docs/SECURITY.md.
- **UI:** keep the two themes, fonts and tokens; breakpoints only 480/768/1024/1280; animate only transform and
  opacity (colour on hover); respect `prefers-reduced-motion`; nothing animates on re-render or the desktop's 30 s
  poll. See docs/DESIGN.md. Copy is sentence case; error messages say what happened and what to do.

## Windows gotchas (this repo is developed on Windows 11)

- Python `open(..., 'w')` writes CRLF; use `newline=''` or the Edit tool. Some files (e.g. `tests/e2e/*.spec.ts`)
  are CRLF already; match what's there.
- In Git Bash, don't put `C:/...` paths in `PATH` (the colon splits it); use `/c/...`.
- `docker compose logs -f` re-attaches after a container is recreated: before starting a new follower, stop old
  ones or log lines are written several times (tests that count log lines then fail).
- The agent writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\AknologiaUsage` on start when
  `startAtLogin` is on (default). In tests, pre-create `state.json` with `"startAtLogin": false` or restore the value.
- `python3` in Git Bash is the Microsoft Store stub; `scripts/e2e.sh` needs a `python3` shim (see docs/TESTING.md).

## Ports used in development

`8080` server (compose) · `5432` compose Postgres (a local Postgres may also listen there; use
`docker compose exec -T db psql -U postgres -d aknologia`) · `5173` admin dev · `5174` desktop dev ·
`47811` agent local API (the desktop UI is hard-wired to it) · `8091–8099`, `5544x` free for throwaway test servers/DBs.

## Where to look next

- How data flows and every endpoint: `docs/ARCHITECTURE.md`
- Session file formats: `docs/PARSERS.md` · Prices: `docs/PRICING.md`
- UI system: `docs/DESIGN.md` · Tests: `docs/TESTING.md` · Security model: `docs/SECURITY.md`
- What's done and what's open: `docs/STATUS.md` · Deploying: `docs/DEPLOY.md`
