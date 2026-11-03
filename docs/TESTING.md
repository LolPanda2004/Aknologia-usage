# Testing

All test code lives under `tests/` except Go unit tests (next to the code). Browser suites use Playwright installed
in `tests/e2e/node_modules` (`tests/a11y` and `tests/responsive` link to it). Never point tests at a real database
or send real email; dev mode prints codes to the server log, and the suites read them from there.

## Suites

| Suite | Run | Needs | Expect |
|---|---|---|---|
| Go unit (backend) | `cd backend && go test ./...` | — | pricing golden cases, catalog shape, agent copy identical, rate-limit IP |
| Go unit (agent) | `cd agent && go test ./...` | — | parser fixtures + billing fields, store (final streamed line wins, resend, in-flight updates, concurrency), list-price summary, exact active seconds |
| API flow | `LOG=<server log> BASE=http://localhost:8080 bash scripts/e2e.sh` | **fresh DB**, dev mode, `python3` | `ALL_PASSED` (budget alerts must fire) |
| API suite | `BASE=… LOGFILE=… DB_CONTAINER=… node tests/api/run.mjs` | dev-mode server | 47/47 |
| Fix checks | `node tests/api/verify-fixes.mjs` (same env) | dev-mode server | 4/4 |
| Rate limit + no-SMTP | `BASE=… LOGFILE=… DB_CONTAINER=… node tests/api/ratelimit.mjs` | **fresh** server with `DEV_MODE=false`, no `SMTP_HOST` | 3/3 (no-SMTP test runs first; the limiter is per IP, in memory) |
| Admin console | `cd tests/e2e && npx playwright test -c playwright.admin.config.ts` | server on :8080 with current bundle | 39 passed, 45 skipped (full flow runs in light-1440; `FULL_ALL=1` for all) |
| Member window | `npx playwright test -c playwright.member.config.ts` | :8080, `npm run dev:desktop` on 5174, agent built at `tests/bin/aknologia-agent.exe` (current code) | 13/13 |
| Landing | `npx playwright test -c playwright.landing.config.ts` | :8080 | 28/28 |
| Accessibility | `cd tests/a11y && npx playwright test -c playwright.a11y.config.ts` (`keyboard` for the keyboard pass) | :8080 | keyboard 6/6; axe: only the known landing CTA contrast |
| Responsive | `cd tests/responsive && npx playwright test -c playwright.check.config.ts` (+ `playwright.responsive.config.ts` for the full matrix) | :8080, 5174, agent on 47811 | 10/10; `node summarize.mjs after --compare before` |
| Pricing on real data | `tests/real-check.ps1` then `tests/api/verify-pricing.mjs` | your own `~/.claude`, `~/.codex`; a throwaway server | see docs/PRICING.md |

Run the Playwright configs one at a time: they share `tests/e2e/test-results-*` folders and parallel runs can
delete each other's output.

## Environment variables used by the Node suites

`BASE` (server URL, default `http://localhost:8080`), `LOGFILE` (server log with codes, default
`tests/.server.log`), `DB_CONTAINER` (Postgres container for `docker exec psql`; unset = compose service `db`),
`ONLY` (regex to run a subset of `run.mjs`; later tests depend on earlier setup tests).

## Throwaway server for a fresh database

```bash
docker run -d --name akn-t-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=aknologia -p 55444:5432 postgres:16-alpine
cd backend && go build -o ../tests/api/.bin/akn-server-test.exe ./cmd/server && cd ..
PORT=8096 DEV_MODE=true PUBLIC_URL=http://localhost:8096 \
  DATABASE_URL="postgres://postgres:postgres@localhost:55444/aknologia?sslmode=disable" \
  ./tests/api/.bin/akn-server-test.exe > tests/api/.server-8096.log 2>&1 &
```

Stream the compose server log for the suites: `docker compose logs -f server >> tests/.server.log` (only one
follower; see CLAUDE.md).

`scripts/e2e.sh` calls `python3`; on Windows create a shim directory with a `python3` script that execs the real
`python.exe`, and put it first in `PATH` using the `/c/...` form.

## Fixtures

- `tests/fixtures/parsers/home/`: 34 Claude Code / Codex files covering streamed duplicates, `<synthetic>`, missing
  usage, broken JSON, partial last line, 5 MB line, unicode paths, Codex repeats / `info: null` / no `payload`, with
  `expected.json` (156 events, 5 unread). Prompt text contains `SECRET_` markers that must never reach the agent's
  data or the database.
- `tests/fixtures/member/`: generator for the member window suite (dates relative to today).
- `tests/agent/genperf.mjs`: 200k-event performance set.

## Results and reports

`tests/REPORT.md` (original QA report), `tests/*/RESULTS*.md` per area, `tests/responsive/{AUDIT,PLAN,STEPS,COMPARE}.md`
for the responsive work, screenshots under `tests/e2e/screenshots/` and `tests/responsive/screenshots/{before,after}/`.
