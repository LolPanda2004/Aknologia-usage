## 6. Landing page and developer experience

QA agent 6, 2026-10-10. Windows 11, PowerShell 5.1.26100, Go 1.26.4, Node 24.19, Docker Compose v5.4.0, Wails CLI v2.13.0. No product code was changed.

### What I ran

| Step | How | Result |
|---|---|---|
| Landing E2E | `tests/e2e/landing.spec.ts` + `playwright.landing.config.ts`. 7 tests x 4 projects (light/dark x 1440/390) against :8080 | 28/28 passed. Results are in `tests/dx/landing-results-*.json`, screenshots in `tests/e2e/screenshots/landing-*.png` and `download-*.png` |
| Demo rows in DB | `psql ... select * from demo_requests where email like 'qa6-%'` | 4 rows, one per project. Every row has `slot = 'Wed 15 Oct 14:00'` (see LAND-02) |
| Clean copy | `robocopy ... %TEMP%\akn-clean /E /XD node_modules dist build tests .git` | OK (91 files) |
| README step 1, `docker compose up -d db` | Not run as written: host port 5432 is already taken (lead's db and a local Postgres service) | Would fail on most Windows machines that have Postgres installed (DX-07) |
| README step 2, `cd ui && npm install && npm run build:admin && cd ..` | Run as written in PS 5.1 | **Fails**: "The token '&&' is not a valid statement separator" (DX-01) |
| ...the same steps one by one | `npm install`, `npm run build:admin` | OK. install took 29 s, build 1.4 s. npm warns that the esbuild postinstall script is not covered by allowScripts; the build still works |
| README step 3, `DEV_MODE=true go run ./cmd/server` | Run as written in PS | **Fails**: "The term 'DEV_MODE=true' is not recognized" (DX-01) |
| ...the PS equivalent | `$env:DATABASE_URL=...:55436...; $env:DEV_MODE='true'; $env:PORT='8096'; go run ./cmd/server` | OK. `/`, `/app/`, `/download/` and `/api/v1/health` all return 200 |
| `make test` | Run as written | **Fails**: `make` is not installed (not in PS, not in Git Bash) (DX-02) |
| ...the equivalents | `go vet ./...` in backend, `go test ./...` and `go vet` in agent, `npm run typecheck` in ui | All pass. Only `agent/internal/parse` has tests; the backend has none (DX-12) |
| `npm run build` (ui) | | OK (admin + desktop) |
| `go run ./cmd/server -migrate` | Against :55436 | OK: "migrations applied". With an unreachable DB it fails after about 15 s with a clear "database unreachable" error |
| `docker compose up --build` | In the copy: `-p akn-clean -f docker-compose.yml -f docker-compose.qa.yml`. The override uses `ports: !override [...]` | OK. db is healthy, server starts, all routes return 200 on :8096. A plain override file *adds* ports instead of replacing them, so `!override` is needed (DX-07) |
| `docker build -t akn-qa6 .` | | OK, 24 MB image. The binary inside is **go1.22.12** (DX-04) |
| Image with ONLY `DATABASE_URL` | `docker run -e DATABASE_URL=...host.docker.internal:55436...` | Starts. The only warning is `warning: APP_SECRET is not set`. There is no warning for PUBLIC_URL or SMTP. A signup then returns 200 and **prints the OTP code to the log** even though dev=false (DX-03) |
| `cd desktop; go mod tidy; wails build` | PS, Wails v2.13.0 | OK in 2 m 47 s. Output: `desktop\build\bin\aknologia-usage.exe` (11.5 MB). `go mod tidy` made no changes |
| npm audit | ui/ and tests/e2e | ui: 2 issues (vite 5.4.11 high, esbuild 0.21.5 moderate; both are dev-server issues). tests/e2e: 0 |
| go list -m all | backend, agent | backend: only `github.com/lib/pq v1.10.9`. agent: standard library only |
| govulncheck | `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` (v1.8.0) | Source mode with local go1.26.4: 12 reachable stdlib vulns (backend), about 14 (agent), all fixed in go1.26.5 to 1.26.9. No vulns in third-party modules called. **Binary mode on the production image's server (go1.22.12): 63 reachable stdlib vulns** |
| Cleanup | `compose -p akn-clean down -v --rmi local`, `docker rmi akn-qa6`, temp files removed | Done. Only `aknologia-*` remain. The clean copy is left at `%TEMP%\akn-clean` for inspection |

### Landing results

* **Nav/anchors**: 30 links. `/app/` and `/app/#/signup` return 200, and `#product`, `#security`, `#pricing`, `#demo`, `#faq` and `#top` resolve and scroll. **11 anchors have no target** (LAND-01).
* **Theme toggle**: switches and persists after reload (`localStorage['akn-theme']`) in all 4 projects. Body background changes correctly (dark `rgb(8,18,15)`, light `rgb(244,247,245)`).
* **Pricing**: the default is annual (aria-pressed). Monthly shows $0 / $12 / $22 / Custom with "Billed monthly", annual shows $0 / $9 / $18 / Custom. All spans switch. The prices match `planPrices` in `admin_handlers.go:729`.
* **Demo form**: an empty submit shows "Enter your name and work email." (server-side). A bad email is blocked by the browser (`type=email`). A valid submit returns 200, shows the thank-you text, resets the form, and the row is in `demo_requests`. **Only 1 of the 9 time-slot buttons works** (LAND-02).
* **Sign in**: goes to `/app/` (title "Aknologia · Admin console").
* **/download/**: the page returns 200. **All 3 installer links return 404**: `aknologia-usage-macos.zip`, `aknologia-usage-windows.zip`, `aknologia-usage-linux.tar.gz` (LAND-03).
* **390 px**: no horizontal page scroll (scrollWidth = 390). The comparison table is 820 px but sits inside an `overflow-x:auto` wrapper, which is fine. The Privacy, Terms and Cookies footer links are 17 px tall (under the 24 px target size).

### Page weight (landing `/`, cold load, Chromium, localhost)

| Metric | Value |
|---|---|
| Requests | 6 for `/` (HTML + 1 Google Fonts CSS + 4 woff2). Another 4 for `/download/`, mostly from cache |
| Total bytes | about 183 KB for `/`: HTML 80.25 KB (**uncompressed**), fonts 101.5 KB, font CSS 1.5 KB |
| Images | 0 `<img>` (inline SVG only) |
| FCP / DCL / load | about 530–700 ms / 500–675 ms / 600–795 ms (localhost) |
| Admin `/app/` | index.js 239 KB + css 15.8 KB, both served **uncompressed** (gzip would be 71 KB + 4 KB) |

Performance notes:
1. No gzip or brotli on any response (`Content-Encoding` is absent even with `Accept-Encoding: gzip, br`). Go `http.FileServer` does not compress.
2. No `Cache-Control` on the landing page or on hashed `/app/assets/*`. Only `Last-Modified` is sent, so every visit revalidates. Hashed assets should be `public, max-age=31536000, immutable`.
3. The Google Fonts stylesheet blocks rendering. It has `preconnect` to fonts.googleapis.com but none to `fonts.gstatic.com` (crossorigin). It loads 3 families and 9 weights.
4. The theme script runs at the end of `<body>`, while `<html data-theme="dark">` is hardcoded. Light-preference users probably see a dark flash before the script runs. This is from code review; I could not capture the flash in an automated test.
5. The 80 KB single-line HTML is mostly inline `style=""` attributes. That is fine at this size, but it would compress to roughly 12–15 KB.

### Findings

| ID | Sev | Title | Repro | Expected | Actual | Suspected cause | Suggested fix |
|---|---|---|---|---|---|---|---|
| DX-03 | **Major** (security) | OTP and invite codes are written to production logs when SMTP is not set, even with DEV_MODE=false, and nothing warns about it | `docker run -e DATABASE_URL=... akn-qa6`, then POST `/api/v1/auth/signup` | Startup fails or warns loudly. Codes are never logged when dev=false | Log shows `[mail] ... subject="Your Aknologia code: 399219"` plus the code. API returns 200 `{"status":"verify"}`. The only startup warning is about APP_SECRET | `backend/internal/mail/mail.go:28` (`if s.LogOnly \|\| s.Host == ""`). `cmd/server/main.go:26` only checks APP_SECRET | When `!DevMode && SMTPHost==""`, log a loud startup warning and redact codes, or refuse to start. DEPLOY.md says codes only appear in logs in dev mode, which is wrong today |
| DX-04 | **Major** | The production image is built with Go 1.22 (EOL), which has 63 reachable stdlib vulnerabilities | `docker build`, then `go version` on `/app/server` gives go1.22.12. `govulncheck -mode binary` | A supported Go release | 63 stdlib vulns (net/http, crypto/tls, net/textproto ...) | `Dockerfile:11` `golang:1.22-alpine`, `backend/go.mod:3` `go 1.22` | Use `golang:1.26-alpine` (or a pinned patch release ≥1.26.9) and bump `go` in go.mod. Also bump `node:20-alpine` (`Dockerfile:4`; Node 20 is EOL April 2026) and `alpine:3.20` |
| LAND-03 | **Major** | All installer links on /download/ return 404, and the deploy docs contradict .gitignore | HEAD `/download/aknologia-usage-{macos.zip,windows.zip,linux.tar.gz}` | 200, or a clear "not published yet" state | 404 plain-text "404 page not found" for all three. Invite emails link to this page | `.gitignore` ignores `landing/download/*.zip` and `*.tar.gz`, but `docs/DEPLOY.md:115` says "Commit those files and redeploy". Render builds from git, so the files never arrive | Remove those `.gitignore` lines (or `git add -f`), or recommend `DOWNLOAD_URL` + GitHub Releases as the default path. Have the page hide or disable links that are missing. Consider offering `prebuilt/` agents |
| LAND-02 | **Major** | Demo booking: only one time slot is clickable, so every request books "Wed 15 Oct 14:00" | Click any slot other than the preselected one, then submit | The chosen slot is highlighted and saved | Nothing happens on click. All 4 DB rows have `slot='Wed 15 Oct 14:00'` | `landing/index.html:20`: 8 of the 9 time `<button>`s lack `class="slot"`. The handler at `:38` only binds `.slot`. The default is hardcoded at `:37` | Add `class="slot" aria-pressed="false"` to every slot button. Also: "Wed 15 Oct" is wrong for 2026 (15 Oct 2026 is a Thursday), and the dates are static, so they are already stale. Generate slots from today's date |
| DX-01 | Major (DX) | README commands are bash-only and fail in Windows PowerShell 5.1 | Paste README steps 2, 3 and the `?token=$(...)` line into PowerShell | Works, or Windows equivalents are given | `&&` parse error. `DEV_MODE=true` "not recognized". `$(cd ../agent && ...)` fails | `README.md:32,36,59`, `docs/DEPLOY.md` step 1.4 (`DATABASE_URL='...' go run`), `scripts/*.sh` | Add a PowerShell block: `cd ui; npm install; npm run build:admin; cd ..` / `$env:DEV_MODE='true'; go run ./cmd/server`. Or say "use Git Bash" |
| DX-02 | Minor | `make` targets do not work on Windows | `make test` | Works, or an alternative is documented | `make` not found in PS or Git Bash | `README.md:66-75`, `Makefile` | List the raw commands next to each target, or add `scripts/dev.ps1`. Also `make build` writes `dist/server` with no `.exe` on Windows |
| DX-07 | Minor | Local Postgres on host port 5432 clashes with the compose db, and overriding the port is not obvious | `docker compose up -d db` while a local Postgres is running (common on Windows) | Works, or docs mention the port | Bind error. If the bind does succeed, `localhost:5432` may reach the *local* Postgres instead, giving confusing auth or DB errors | `docker-compose.yml:9`, `.env.example:2` | Make the port configurable: `ports: ["${DB_PORT:-5432}:5432"]`. Document that an override file needs `!override` (Compose merges port lists) |
| LAND-01 | Minor | 11 footer and nav anchors go nowhere | Click Desktop app, Admin console, Changelog, About, Careers, Contact, Privacy (x2), System status, Terms, Cookies | Each scrolls to or opens a page | Nothing happens (no element with that id) | `landing/index.html:20` (`href="#desktop-app"` etc.) | Point them at real sections (`#product`) or pages, or remove them. Privacy, Terms and Cookies are needed legally before launch |
| DX-05 | Minor | APP_SECRET is required, documented and generated, but never used | `grep -rn AppSecret backend` | Used as the token pepper (per the config.go comment) | Only read in the startup warning. `auth.Hash` uses no secret | `backend/internal/config/config.go:13`, `cmd/server/main.go:26` | Either wire it into token hashing (HMAC) or drop it from docs and render.yaml. The current state gives false assurance |
| DX-06 | Minor | Missing PUBLIC_URL produces no warning, so production email links point to `http://localhost:8080` | Image with only DATABASE_URL | Warning or failure when dev=false and PUBLIC_URL is the default | Silent. Invite and alert links and DOWNLOAD_URL use localhost | `config.go:43,51`, `main.go:26` | Warn like APP_SECRET, or derive it from `RENDER_EXTERNAL_URL` |
| DX-08 | Minor | render.yaml and DEPLOY.md disagree on the Neon string | Compare | One recommendation | `render.yaml:12` says "Neon **pooled** connection string"; `DEPLOY.md:27` says "Use the **direct** (non-pooled) string" | docs | Pick one (direct is the safer default for lib/pq) |
| DX-09 | Minor | Wails and Go versions in the docs do not match desktop/go.mod | Follow README step 6 / DEPLOY 5 | The CLI matches the library | Docs pin `wails@v2.9.2` and "Go 1.22+". `desktop/go.mod` needs `go 1.25.0` and `wails/v2 v2.13.0`. Built OK with CLI v2.13.0 | `README.md:24,49`, `DEPLOY.md:102-103` | Change to `wails@v2.13.0` and "Go 1.25+ for desktop". Linux `libwebkit2gtk-4.0-dev` (DEPLOY:106) is not available on Ubuntu 24.04; mention `-tags webkit2_41` |
| DX-10 | Minor | ui dev dependencies have known vulns (dev server only) | `npm audit` in ui | 0 | vite 5.4.11 (high: fs.deny bypasses including a Windows backslash one, and cross-origin read of the dev server), esbuild ≤0.24.2 (moderate) | `ui/package.json` | Upgrade to vite ≥6.4.3 / 7.x (and plugin-react to match). Not shipped in the image, but the dev server runs on developer laptops |
| DX-11 | Minor | No compression and no cache headers on static files | `curl -I -H 'Accept-Encoding: gzip' :8080/` and `/app/assets/*.js` | gzip/br, and `immutable` on hashed assets | Raw 80 KB / 239 KB, no Cache-Control | `backend/internal/api/server.go:250-262` (`spa`, `static`) | Add a gzip middleware (or pre-compressed files) and Cache-Control for `/app/assets/` |
| DX-13 | Minor | CORS allows any `http://localhost*` origin in production, and checks PUBLIC_URL by prefix | Code review. Verified `Origin: http://localhost:9999` is reflected with dev=false | Exact origin match in prod | `HasPrefix(origin, PublicURL)` would also allow `https://svc.onrender.com.evil.com` | `server.go:155` | Exact-match PublicURL; allow localhost only when DevMode. Impact is limited because the API uses bearer tokens, not cookies |
| LAND-04 | Minor | The demo endpoint accepts junk and huge payloads, and nobody is notified | POST `{"name":"x","email":"@"}` → 200. A 2 MB message → 200 | Basic email validation, length limits, and the sales team is emailed or the admin can see the request | Stored. Nothing reads `demo_requests` except the DB | `auth_handlers.go:376-389` | Cap field lengths, validate the email, send a notification mail. The rate limit is off in DEV_MODE and keyed on spoofable `X-Forwarded-For` (`server.go:181`) |
| LAND-05 | Note | The landing script reads localStorage without try/catch | Code review | The page works when storage is blocked | `localStorage.getItem` throwing (storage blocked or some private modes) aborts the whole IIFE. Theme, pricing toggle and demo form all stop working | `landing/index.html:24` | Wrap in try/catch. Move the theme lines into `<head>` to avoid the flash |
| LAND-06 | Note | /download/ ignores the theme chosen on the landing page | Pick light on `/`, open `/download/` with a dark OS | Same theme | `/download/` follows only `prefers-color-scheme` (hardcoded `data-theme="dark"`). It has no link back to `/` or `/app/` | `landing/download/index.html:2,8` | Read `akn-theme`. Add a header link |
| LAND-07 | Note | Footer Privacy, Terms and Cookies links are 17 px tall at 390 px | Playwright bounding box | ≥24 px target (WCAG 2.5.8) | 36–46 x 17 px | `landing/index.html:20` footer | Add padding / min-height |
| DX-12 | Note | `make test` covers little: the backend has zero tests, and only `agent/internal/parse` has tests | `go test ./...` | | `[no test files]` for every backend and most agent packages | | Add API tests (`scripts/e2e.sh` exists but is bash-only and needs a running server) |
| DX-14 | Note | render.yaml looks valid | Manual review against Render Blueprint fields | | `type: web`, `runtime: docker`, `dockerfilePath: ./Dockerfile` (context defaults to repo root, which is correct), `healthCheckPath: /api/v1/health` exists, envVars match `config.go` names. DEV_MODE, DOWNLOAD_URL, MIN_AGENT_VERSION and CORS_ORIGINS are left at their defaults, which is fine. Render injects `PORT`, and the server honours it | | Optional: add `DEV_MODE: "false"` explicitly. Not deployed to Render (no account), so this is not proven |

DEPLOY.md accuracy (other items): env var names and defaults match `config.go`. The health URL and response are correct. `schema_migrations` → `001_init.sql` is correct. Pricing columns and the order in the `INSERT` example match `001_init.sql:127`, and the `opus` row exists. The `-scan-once` flag, the `state.json` `"synced"` field, the 14-day invite TTL, the 2-minute sync jitter and the Starter 3-seat limit all match the code. The connection retry ("server retries") is 5 attempts over about 15 s.

### Not verified, and why
* README step 1 as written (`docker compose up -d db` on 5432): port 5432 belongs to the lead's stack and a local Postgres. I ran it on port 55436 instead.
* README "no Wails" path (`-print-token`, `npm run dev:desktop` on 5174): port 5174 and the agent's AppData token are reserved for other agents.
* `wails dev`: interactive. `wails build` was verified instead.
* The installer packaging script (`scripts/build-desktop.sh`): it writes into `landing/download`, so I did not run it.
* A real Render or Neon deploy: not allowed (no real Neon or SMTP).
* The theme flash (FOUC) on the landing page is from code review only.
* The DEPLOY.md pricing `UPDATE`/`INSERT` were checked against the schema but not executed (a DB write was blocked by the permission classifier).
