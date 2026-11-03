-- Exact API-equivalent pricing: each request is priced on its own at the list price in effect that day.

-- Billing details recorded per request (Claude Code logs all of these).
ALTER TABLE usage_events
    ADD COLUMN cache_write_1h_tokens bigint NOT NULL DEFAULT 0,   -- part of cache_write_tokens written to the 1-hour cache
    ADD COLUMN speed            text   NOT NULL DEFAULT '',     -- 'fast' = fast mode
    ADD COLUMN inference_geo    text   NOT NULL DEFAULT '',     -- 'us' = US-only inference (x1.1)
    ADD COLUMN web_search_requests bigint NOT NULL DEFAULT 0,
    ADD COLUMN cost_micros      bigint,                         -- USD x 1e6; NULL = no price for this model (shown as unpriced)
    ADD COLUMN savings_micros   bigint NOT NULL DEFAULT 0;      -- saved by caching, net of the cache-write premium

ALTER TABLE daily_usage
    ADD COLUMN cache_write_1h_tokens bigint NOT NULL DEFAULT 0,
    ADD COLUMN savings_micros   bigint NOT NULL DEFAULT 0,
    ADD COLUMN unpriced_events  int    NOT NULL DEFAULT 0;

-- List prices in USD per million tokens. 'catalog' rows are rewritten from the server's built-in catalog on every
-- start; add 'custom' rows to override or extend it (a custom row wins over a catalog row with the same date).
CREATE TABLE model_prices (
    provider        text NOT NULL,                          -- anthropic | openai
    model           text NOT NULL,                          -- exact model ID after normalization (lowercase, no date suffix)
    effective_from  date NOT NULL,
    source          text NOT NULL DEFAULT 'custom',         -- catalog | custom
    input           numeric NOT NULL,
    cache_write_5m  numeric NOT NULL DEFAULT 0,
    cache_write_1h  numeric NOT NULL DEFAULT 0,
    cache_read      numeric NOT NULL,
    output          numeric NOT NULL,
    fast_input      numeric NOT NULL DEFAULT 0,             -- fast mode prices (0 = not offered)
    fast_output     numeric NOT NULL DEFAULT 0,
    geo_us          numeric NOT NULL DEFAULT 0,             -- multiplier for US-only inference (0 = not applicable)
    web_search_per_1k numeric NOT NULL DEFAULT 0,
    long_over       bigint NOT NULL DEFAULT 0,              -- prompts over this many tokens use the long_* prices (0 = none)
    long_input      numeric NOT NULL DEFAULT 0,
    long_cache_write_5m numeric NOT NULL DEFAULT 0,
    long_cache_write_1h numeric NOT NULL DEFAULT 0,
    long_cache_read numeric NOT NULL DEFAULT 0,
    long_output     numeric NOT NULL DEFAULT 0,
    catalog_version text,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (model, effective_from, source)
);

-- The old substring-matched placeholder table is replaced by model_prices.
DROP TABLE pricing;
