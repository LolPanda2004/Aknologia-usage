# Aknologia Usage

Usage intelligence for teams on **Claude Code** and **Codex**. A desktop app reads each developer's local session
files, keeps only usage numbers (tokens, model, timestamps), and syncs them hourly to your server. Admins get a web
console with team dashboards, budgets with email alerts, members, billing, and support. Prompts, code, and file
names never leave the developer's machine.

© 2026 Aknologia. All rights reserved.

## What's in this repository

| Folder | What it is | Language |
|---|---|---|
| `backend/` | API server. Also serves the admin console at `/app/` and the landing page at `/`. | Go 1.22, Postgres |
| `agent/` | Background agent on each laptop: reads sessions, stores locally, syncs hourly, desktop notifications, local API for the window. | Go 1.22 (standard library only) |
| `desktop/` | Desktop window (Wails shell). Starts and pairs with the agent. | Go + Wails v2 |
| `ui/` | Both interfaces: `ui/admin` (web console) and `ui/desktop` (desktop window), sharing `ui/shared`. | React 18, TypeScript, Vite |
| `landing/` | Marketing site (pricing, demo booking) and the `/download/` page for installers. | Static HTML |
| `scripts/` | `build-desktop.sh` (packages installers), `e2e.sh` (end-to-end API test). | Bash |
| `docs/` | `DEPLOY.md` (Neon, email, Render, desktop), `ARCHITECTURE.md`, `PARSERS.md`, `PRICING.md`, `DESIGN.md`, `SECURITY.md`, `TESTING.md`, `STATUS.md`. See also `CLAUDE.md`. | |

## Run it locally (about 10 minutes)

Prerequisites: **Go 1.22+**, **Node 20+**, and **Docker** (for Postgres). For the desktop window you also need the
**Wails CLI** (see step 5).

```bash
# 1. Database
docker compose up -d db

# 2. Build the admin console (the server serves it at /app/)
cd ui && npm install && npm run build:admin && cd ..

# 3. Server: API + admin console + landing page on http://localhost:8080
cd backend
DEV_MODE=true go run ./cmd/server
#   DEV_MODE prints every email and one-time code to this terminal, so no SMTP is needed locally.
```

4. Open **http://localhost:8080/app/#/signup**, create a workspace, and paste the 6-digit code from the server
   terminal. Then go to **Members → Invite members** and invite yourself at a second address; the invite code is
   printed in the terminal.

```bash
# 5. Background agent (new terminal) — reads ~/.claude and ~/.codex on this machine
cd agent
go run ./cmd/aknologia-agent -server http://localhost:8080

# 6. Desktop window (new terminal). One-time: go install github.com/wailsapp/wails/v2/cmd/wails@v2.9.2
cd desktop
go mod tidy          # downloads Wails
wails dev            # opens the window; choose "I have an invite" and enter the code from step 4
```

No Wails yet? You can run the desktop window in a browser instead:

```bash
cd ui && npm run dev:desktop
# open http://localhost:5174/?token=$(cd ../agent && go run ./cmd/aknologia-agent -print-token)
```

Everything at once with Docker (server + database, no desktop): `docker compose up --build`.

## Common commands

| Command | Does |
|---|---|
| `make dev-server` | Server in dev mode on :8080 |
| `make dev-admin` | Admin console with hot reload on :5173 (proxies `/api` to :8080) |
| `make dev-agent` | Agent against the local server |
| `make dev-desktop` | Desktop window with hot reload (Wails) |
| `make test` | Go vet, agent unit tests, TypeScript type-check |
| `./scripts/e2e.sh` | Full API flow against a running dev server (signup → invite → ingest → alerts → removal) |
| `SERVER_URL=https://… ./scripts/build-desktop.sh` | Build and package the desktop app for this OS |
| `cd backend && go run ./cmd/server -migrate` | Apply database migrations and exit |

## Going to production

Follow **[docs/DEPLOY.md](docs/DEPLOY.md)**: Neon (database) → an SMTP provider (email) → Render (server) →
build and publish the desktop app → create your workspace and invite the team.

## Before you rely on the numbers

* **Prices.** Spend is the API-equivalent cost of each request at the vendors' list prices (built-in price list,
  checked 2026-10-10). Models without a price are listed under Data health instead of guessed. To add or change a
  price, see DEPLOY.md, step 7.
* **Codex token mapping.** See [docs/PARSERS.md](docs/PARSERS.md). Verify against one of your real Codex session files.
* **Billing.** Plans, seats, and invoices are recorded and shown, but card payments are not connected to a payment
  provider yet.
