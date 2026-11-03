-- Aknologia Usage: initial schema. Applied once; tracked in schema_migrations.

CREATE TABLE orgs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    plan            text NOT NULL DEFAULT 'starter',      -- starter | team | business | enterprise
    seats           int  NOT NULL DEFAULT 3,
    billing_period  text NOT NULL DEFAULT 'annual',
    renews_on       date,
    billing_email   text,
    billing_details text,
    timezone        text NOT NULL DEFAULT 'UTC',
    default_budget_cents int NOT NULL DEFAULT 15000,
    alert_80        boolean NOT NULL DEFAULT true,
    alert_100       boolean NOT NULL DEFAULT true,
    weekly_summary  boolean NOT NULL DEFAULT true,
    email_member_at_100 boolean NOT NULL DEFAULT false,
    alert_inboxes   text[] NOT NULL DEFAULT '{}',
    project_salt    text NOT NULL,
    last_refreshed_at timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email           text NOT NULL,
    name            text NOT NULL DEFAULT '',
    role            text NOT NULL DEFAULT 'member',        -- admin | member
    status          text NOT NULL DEFAULT 'invited',       -- invited | active | removed | unverified
    password_hash   text,
    password_changed_at timestamptz,
    backup_email    text,
    backup_verified boolean NOT NULL DEFAULT false,
    budget_cents    int,                                   -- NULL = org default
    code_on_new_device boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    removed_at      timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_org_idx ON users (org_id);

CREATE TABLE invites (
    code_hash   text PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        text NOT NULL,                              -- desktop | web
    name        text NOT NULL DEFAULT '',
    os          text NOT NULL DEFAULT '',
    app_version text NOT NULL DEFAULT '',
    unread_lines int NOT NULL DEFAULT 0,
    last_seen   timestamptz NOT NULL DEFAULT now(),
    last_sync   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz
);
CREATE INDEX devices_user_idx ON devices (user_id);

CREATE TABLE sessions (
    token_hash  text PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id   uuid REFERENCES devices(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE otps (
    id          bigserial PRIMARY KEY,
    email       text NOT NULL,
    user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
    purpose     text NOT NULL,                              -- verify_signup | reset | change_password | verify_backup | delete_data
    code_hash   text NOT NULL,
    payload     jsonb NOT NULL DEFAULT '{}',
    attempts    int NOT NULL DEFAULT 0,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otps_lookup_idx ON otps (lower(email), purpose, created_at DESC);

CREATE TABLE usage_events (
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id       uuid REFERENCES devices(id) ON DELETE SET NULL,
    tool            text NOT NULL,                          -- claude_code | codex
    session_id      text NOT NULL,
    message_id      text NOT NULL,
    request_id      text NOT NULL DEFAULT '',
    model           text NOT NULL DEFAULT '',
    input_tokens    bigint NOT NULL DEFAULT 0,
    output_tokens   bigint NOT NULL DEFAULT 0,
    cache_write_tokens bigint NOT NULL DEFAULT 0,
    cache_read_tokens  bigint NOT NULL DEFAULT 0,
    ts              timestamptz NOT NULL,
    project_hash    text NOT NULL DEFAULT '',
    parser_version  text NOT NULL DEFAULT '',
    received_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tool, session_id, message_id, request_id)
);
CREATE INDEX usage_events_user_ts_idx ON usage_events (user_id, ts);
CREATE INDEX usage_events_ts_idx ON usage_events (ts);

-- Recomputed by "Refresh data" and after each ingest for the affected user.
CREATE TABLE daily_usage (
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day             date NOT NULL,
    tool            text NOT NULL,
    model           text NOT NULL,
    input_tokens    bigint NOT NULL,
    output_tokens   bigint NOT NULL,
    cache_write_tokens bigint NOT NULL,
    cache_read_tokens  bigint NOT NULL,
    cost_micros     bigint NOT NULL,                        -- USD * 1e6
    events          int NOT NULL,
    PRIMARY KEY (user_id, day, tool, model)
);

CREATE TABLE pricing (
    model_match     text PRIMARY KEY,                       -- case-insensitive substring of the model name
    priority        int NOT NULL DEFAULT 100,               -- lower wins when several match
    input_per_mtok  numeric NOT NULL,
    output_per_mtok numeric NOT NULL,
    cache_write_per_mtok numeric NOT NULL,
    cache_read_per_mtok  numeric NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Placeholder list prices in USD per million tokens. VERIFY against current vendor pricing before relying on cost figures.
INSERT INTO pricing VALUES
  ('opus',   10, 15.00, 75.00, 18.75, 1.50, now()),
  ('sonnet', 20,  3.00, 15.00,  3.75, 0.30, now()),
  ('haiku',  30,  1.00,  5.00,  1.25, 0.10, now()),
  ('codex',  40,  1.25, 10.00,  0.00, 0.125, now()),
  ('gpt',    50,  1.25, 10.00,  0.00, 0.125, now()),
  ('',      999,  3.00, 15.00,  3.75, 0.30, now());

CREATE TABLE budget_alerts (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month       date NOT NULL,
    threshold   int NOT NULL,                               -- 80 | 100
    spent_cents int NOT NULL,
    budget_cents int NOT NULL,
    sent_to     text NOT NULL DEFAULT '',
    sent_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, month, threshold)
);

CREATE TABLE notifications (
    id          bigserial PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        text NOT NULL,
    title       text NOT NULL,
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    read_at     timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE tickets (
    id          bigserial PRIMARY KEY,
    org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    kind        text NOT NULL,                              -- bug | feature | question
    title       text NOT NULL,
    body        text NOT NULL,
    severity    text NOT NULL DEFAULT '',
    started     text NOT NULL DEFAULT '',
    diagnostics jsonb,
    status      text NOT NULL DEFAULT 'Open',               -- Open | In review | Planned | Fixed
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
    id          bigserial PRIMARY KEY,
    org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    number      text NOT NULL,
    description text NOT NULL,
    amount_cents int NOT NULL,
    status      text NOT NULL DEFAULT 'Paid',
    issued_on   date NOT NULL DEFAULT current_date
);

CREATE TABLE demo_requests (
    id          bigserial PRIMARY KEY,
    name        text NOT NULL,
    email       text NOT NULL,
    company     text NOT NULL DEFAULT '',
    team_size   text NOT NULL DEFAULT '',
    slot        text NOT NULL DEFAULT '',
    message     text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);
