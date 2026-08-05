-- Migration: 0005_virtual_key_limits
-- Virtual-key limits, per-key daily usage, request spend logs, and cost.

-- Virtual key capabilities (mirror LiteLLM virtual keys).
--   rpm_limit             — max requests per minute (per-isolate best effort)
--   daily_request_limit   — max requests per UTC day (authoritative, D1)
--   daily_token_limit     — max total tokens per UTC day (authoritative, D1)
--   expires_at            — unix seconds; the key stops working after this
--   model_allowlist       — JSON array of unified model ids; empty = all models
ALTER TABLE gateway_api_keys ADD COLUMN rpm_limit INTEGER;
ALTER TABLE gateway_api_keys ADD COLUMN daily_request_limit INTEGER;
ALTER TABLE gateway_api_keys ADD COLUMN daily_token_limit INTEGER;
ALTER TABLE gateway_api_keys ADD COLUMN expires_at INTEGER;
ALTER TABLE gateway_api_keys ADD COLUMN model_allowlist TEXT;

-- Per-key daily aggregation: drives daily budgets and per-key spend.
CREATE TABLE key_daily_usage (
  key_id TEXT NOT NULL,
  date TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, date)
);

-- Recent request spend log (bounded retention; cleaned by the daily cron).
CREATE TABLE request_logs (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  request_id TEXT,
  key_id TEXT,
  key_name TEXT,
  model_card_id TEXT,
  unified_model_id TEXT,
  channel_id TEXT,
  channel_name TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('success','error','cancelled','rate_limited','budget_exceeded','not_allowed','expired')),
  stream INTEGER NOT NULL DEFAULT 0,
  cached INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  fallback INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_request_logs_timestamp ON request_logs(timestamp DESC);
CREATE INDEX idx_request_logs_key ON request_logs(key_id, timestamp DESC);

-- Cost tracking for the aggregate usage stats.
ALTER TABLE usage_minutes ADD COLUMN cost_micros INTEGER NOT NULL DEFAULT 0;
