# Pricing

Spend is the **API-equivalent cost** of every request at the vendor's list price, priced one request at a time the
way the API bills it. Most teams use Claude/ChatGPT subscriptions, so there is no per-token invoice to match; this
is the most accurate number available without a billing API.

## Where it lives

| File | Role |
|---|---|
| `backend/internal/pricing/catalog.json` | Price list (USD per million tokens), with source URLs and check date |
| `backend/internal/pricing/engine.go` | `Normalize`, `Catalog.Find` (effective dates, custom rows), `Compute` (billing rules) |
| `backend/internal/pricing/pricing.go` | Copies the catalog into `model_prices` at start (advisory lock), loads catalog + custom rows |
| `backend/internal/pricing/testdata/golden.json` | Hand-worked cases; run by both backend and agent tests |
| `agent/internal/pricing/` | Byte-identical copy of `engine.go` and `catalog.json` (desktop window prices offline) |
| `tests/api/verify-pricing.mjs` | Independent re-pricing of real data (own price table typed in by hand) |

## Billing rules implemented (`Compute`)

1. Exact model ID after `Normalize`: lowercase; strip `anthropic.` / `us.anthropic.` / `openai/` prefixes, `[1m]`,
   Bedrock `-v1:0`, `-YYYYMMDD` and `@YYYYMMDD`. No substring matching, no default rate.
2. Price row in effect on the request's date (`from`); a `custom` row beats the catalog row with the same date.
3. Token kinds: input, output, cache read, **5-minute** and **1-hour** cache writes (Claude Code logs
   `usage.cache_creation.ephemeral_{5m,1h}_input_tokens`). Cache-read multipliers differ by model (0.025× Fable 5.1,
   0.05× Opus 5.5 / Sonnet 5.5, 0.1× others).
4. Long context: Claude Haiku 5.5 over 100,000 prompt tokens (input + cache read + cache write) and GPT-5.x over
   272,000 input tokens use the higher rates for the whole request.
5. Fast mode (`usage.speed = "fast"`): fast input/output prices; cache rates scale by the same ratio.
6. US-only inference (`usage.inference_geo = "us"`): ×1.1 on all token prices (Claude 4.6+).
7. Web search: $10 per 1,000 (`usage.server_tool_use.web_search_requests`).
8. Codex: `input = input_tokens − cached_input_tokens`, `cacheRead = cached_input_tokens`; `output_tokens` already
   includes reasoning tokens (verified: `total_tokens = input_tokens + output_tokens`).
9. Saved by caching = cache reads × (input − read price) − cache writes × (write − input price).

Cost is stored per request (`usage_events.cost_micros`, micro-dollars, NULL = unpriced) at ingest;
`daily_usage` adds them up; views round once for display.

## Unknown models

Never guessed. Their requests have `cost_micros = NULL`, are left out of spend, and appear in the admin overview
`dataHealth.unpricedModels` (and `unpricedModels` in the desktop summary). Known unpriced name: `gpt-5-codex`
(OpenAI lists `gpt-5.3-codex`, not `gpt-5-codex`).

## Changing prices

- **In a release:** edit `catalog.json` (bump `version`, keep sources), copy it and `engine.go` to
  `agent/internal/pricing/`, add a golden case, run `go test ./...` in both modules.
- **Without a release:** insert a `custom` row and press **Refresh data** (re-prices every stored request):

```sql
INSERT INTO model_prices (provider, model, effective_from, source, input, cache_write_5m, cache_write_1h, cache_read, output)
VALUES ('openai', 'gpt-5-codex', '2000-01-01', 'custom', 1.25, 0, 0, 0.125, 10);
```

- On every start the server prices any stored request without a cost (`PriceUnpriced`), so a new price also fixes
  history after a restart.

## Verifying against real files

```powershell
powershell -ExecutionPolicy Bypass -File tests\real-check.ps1 -Server http://localhost:8094 -Port 47814 -Exe tests\bin\<agent>.exe -Sandbox price -Email <invited email> -Code <invite code>
# then
DB_CONTAINER=<db container> BASE=http://localhost:8094 MEMBER=<email> ADMIN_TOKEN=<token> SANDBOX=price node tests/api/verify-pricing.mjs
```

Last result (2026-10-10, 7,199 requests from a real laptop): 0 per-request mismatches against the independent
calculator, 0 missing requests, 0 token differences, and the same total ($850.16) in the server, admin overview
and desktop window.

## Older agents

Agents before this change receive legacy `pricing` rows (exact IDs, longest first) in `agent/config` and price
their own window by substring; they may guess a price for an unknown model. The server's numbers are always exact.
