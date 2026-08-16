-- MyGateway public v0.1 database baseline.
-- This file is the immutable starting point for releases. Future schema
-- changes must use a new numbered migration.

PRAGMA foreign_keys = ON;

-- AI provider channels and their native protocol endpoints.
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL
    CHECK (provider_type IN ('openai', 'openai_compatible')),
  base_url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  api_key_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  notes TEXT,
  preset_id TEXT,
  short_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);

CREATE INDEX idx_channels_status
  ON channels(status)
  WHERE deleted_at IS NULL;

CREATE TABLE channel_protocols (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL
    CHECK (protocol IN ('openai_chat', 'openai_responses', 'anthropic_messages')),
  base_url TEXT NOT NULL,
  auth_scheme TEXT NOT NULL DEFAULT 'bearer'
    CHECK (auth_scheme IN ('bearer', 'x_api_key')),
  api_version TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (channel_id, protocol)
);

CREATE INDEX idx_channel_protocols_protocol
  ON channel_protocols(protocol, channel_id);

-- Provider model discovery inventory. These rows are not routable until
-- imported into a unified model.
CREATE TABLE channel_provider_models (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  provider_model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('discovered', 'manual', 'preset')),
  availability TEXT NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available', 'missing', 'unknown')),
  capabilities_json TEXT,
  imported_model_card_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (channel_id, provider_model_id)
);

CREATE INDEX idx_channel_provider_models_availability
  ON channel_provider_models(channel_id, availability, provider_model_id);

CREATE TABLE channel_model_discovery (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'never'
    CHECK (status IN ('never', 'ok', 'error')),
  result_hash TEXT,
  model_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  error_summary TEXT
);

-- Unified model cards and ordered channel instances.
CREATE TABLE model_cards (
  id TEXT PRIMARY KEY,
  unified_model_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);

CREATE TABLE channel_models (
  id TEXT PRIMARY KEY,
  model_card_id TEXT NOT NULL REFERENCES model_cards(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),
  channel_model_id TEXT NOT NULL,
  public_model_alias TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  supports_stream_usage INTEGER NOT NULL DEFAULT 0
    CHECK (supports_stream_usage IN (0, 1)),
  input_price_micros_per_million INTEGER,
  output_price_micros_per_million INTEGER,
  cache_input_price_micros_per_million INTEGER,
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
  plan_tokens_total INTEGER CHECK (plan_tokens_total IS NULL OR plan_tokens_total >= 0),
  plan_tokens_remaining INTEGER CHECK (plan_tokens_remaining IS NULL OR plan_tokens_remaining >= 0),
  plan_expires_at INTEGER,
  manual_metadata_updated_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  UNIQUE(model_card_id, channel_id)
);

CREATE INDEX idx_channel_models_card_order
  ON channel_models(model_card_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_channel_models_channel
  ON channel_models(channel_id)
  WHERE deleted_at IS NULL;

CREATE TABLE model_identifiers (
  identifier TEXT PRIMARY KEY,
  identifier_type TEXT NOT NULL
    CHECK (identifier_type IN ('unified', 'alias')),
  model_card_id TEXT NOT NULL REFERENCES model_cards(id),
  channel_model_id TEXT REFERENCES channel_models(id),
  CHECK (
    (identifier_type = 'unified' AND channel_model_id IS NULL)
    OR
    (identifier_type = 'alias' AND channel_model_id IS NOT NULL)
  )
);

CREATE INDEX idx_model_identifiers_card
  ON model_identifiers(model_card_id);

-- Client-facing Gateway Keys and their authoritative UTC daily ledger.
CREATE TABLE gateway_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  rpm_limit INTEGER CHECK (rpm_limit IS NULL OR rpm_limit >= 0),
  request_limit INTEGER CHECK (request_limit IS NULL OR request_limit >= 0),
  token_limit INTEGER CHECK (token_limit IS NULL OR token_limit >= 0),
  limit_period TEXT NOT NULL DEFAULT 'day'
    CHECK (limit_period IN ('day', 'week', 'month', 'year')),
  expires_at INTEGER,
  model_allowlist TEXT,
  is_temporary INTEGER NOT NULL DEFAULT 0
    CHECK (is_temporary IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);

CREATE INDEX idx_gateway_api_keys_temporary_expiry
  ON gateway_api_keys(expires_at)
  WHERE is_temporary = 1;

CREATE TABLE key_daily_usage (
  key_id TEXT NOT NULL,
  date TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, date)
);

-- Request details and the current 5-minute analytics aggregate.
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
    CHECK (status IN ('success', 'error', 'cancelled', 'rate_limited', 'budget_exceeded', 'not_allowed', 'expired')),
  stream INTEGER NOT NULL DEFAULT 0,
  cached INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  fallback INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_detail TEXT,
  context_request_iv TEXT,
  context_request_tag TEXT,
  context_request_ciphertext TEXT,
  context_response_iv TEXT,
  context_response_tag TEXT,
  context_response_ciphertext TEXT,
  ttft_ms INTEGER,
  requested_protocol TEXT
);

CREATE INDEX idx_request_logs_timestamp ON request_logs(timestamp DESC);
CREATE INDEX idx_request_logs_key ON request_logs(key_id, timestamp DESC);
CREATE INDEX idx_request_logs_cursor ON request_logs(timestamp DESC, id DESC);
CREATE INDEX idx_request_logs_status_time ON request_logs(status, timestamp DESC);
CREATE INDEX idx_request_logs_key_time ON request_logs(key_id, timestamp DESC);
CREATE INDEX idx_request_logs_channel_time ON request_logs(channel_id, timestamp DESC);
CREATE INDEX idx_request_logs_model_time ON request_logs(unified_model_id, timestamp DESC);

CREATE TABLE analytics_minutes (
  timestamp_minute INTEGER NOT NULL,
  model_card_id TEXT NOT NULL,
  unified_model_id_snapshot TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name_snapshot TEXT NOT NULL,
  key_id TEXT NOT NULL DEFAULT '',
  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  attempt_count_total INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  usage_unknown_count INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  latency_ms_sum INTEGER NOT NULL DEFAULT 0,
  latency_ms_count INTEGER NOT NULL DEFAULT 0,
  ttft_ms_sum INTEGER NOT NULL DEFAULT 0,
  ttft_ms_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (timestamp_minute, model_card_id, channel_id, key_id)
);

CREATE INDEX idx_analytics_time ON analytics_minutes(timestamp_minute);
CREATE INDEX idx_analytics_key_time ON analytics_minutes(key_id, timestamp_minute);
CREATE INDEX idx_analytics_model_time ON analytics_minutes(model_card_id, timestamp_minute);

-- Administrator, machine-management credentials, and settings.
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1
    CHECK (must_change_password IN (0, 1)),
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER
);

CREATE TABLE management_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  permission TEXT NOT NULL DEFAULT 'read'
    CHECK (permission IN ('read', 'write')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);

CREATE INDEX idx_management_keys_active_hash
  ON management_keys(key_hash)
  WHERE status = 'active' AND revoked_at IS NULL;

CREATE TABLE management_audit_logs (
  id TEXT PRIMARY KEY,
  management_key_id TEXT REFERENCES management_keys(id) ON DELETE SET NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_management_audit_logs_time
  ON management_audit_logs(created_at DESC);
CREATE INDEX idx_management_audit_logs_key_time
  ON management_audit_logs(management_key_id, created_at DESC);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO system_settings (key, value) VALUES
  ('request_logs_enabled', 'true'),
  ('log_success', 'true'),
  ('log_errors', 'true'),
  ('log_context', 'false'),
  ('context_retention_hours', '24'),
  ('request_log_retention_days', '7');

-- Editable provider-model price defaults, in integer micros per one million
-- tokens. The baseline contains only currently maintained entries.
CREATE TABLE model_prices (
  provider_model_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_price_micros_per_million INTEGER NOT NULL DEFAULT 0,
  output_price_micros_per_million INTEGER NOT NULL DEFAULT 0,
  cache_input_price_micros_per_million INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO model_prices (
  provider_model_id, display_name, provider,
  input_price_micros_per_million, output_price_micros_per_million,
  cache_input_price_micros_per_million, currency
) VALUES
  ('deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', 140000, 280000, 2800, 'USD'),
  ('deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 435000, 870000, 3625, 'USD'),
  ('glm-5.1', 'GLM-5.1', 'zai', 1400000, 4400000, 260000, 'USD'),
  ('glm-5', 'GLM-5', 'zai', 1000000, 3200000, 200000, 'USD'),
  ('glm-4.7', 'GLM-4.7', 'zai', 600000, 2200000, 110000, 'USD'),
  ('qwen3.7-max', 'Qwen3.7 Max', 'alibaba_cloud_intl', 2500000, 7500000, NULL, 'USD'),
  ('qwen3.7-plus', 'Qwen3.7 Plus', 'alibaba_cloud_intl', 400000, 1600000, NULL, 'USD'),
  ('qwen3.6-flash', 'Qwen3.6 Flash', 'alibaba_cloud_intl', 250000, 1500000, NULL, 'USD'),
  ('seed-2-0-pro-260328', 'Seed 2.0 Pro', 'byteplus_modelark', 500000, 3000000, 100000, 'USD'),
  ('seed-2-0-lite-260428', 'Seed 2.0 Lite', 'byteplus_modelark', 250000, 2000000, 50000, 'USD'),
  ('seed-2-0-mini-260428', 'Seed 2.0 Mini', 'byteplus_modelark', 100000, 400000, 20000, 'USD'),
  ('gemini-3.6-flash', 'Gemini 3.6 Flash', 'google_gemini', 1500000, 7500000, 150000, 'USD'),
  ('gemini-3.5-flash', 'Gemini 3.5 Flash', 'google_gemini', 1500000, 9000000, 150000, 'USD'),
  ('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'google_gemini', 300000, 2500000, 30000, 'USD'),
  ('openai/gpt-oss-120b', 'GPT OSS 120B', 'groq', 150000, 600000, NULL, 'USD'),
  ('openai/gpt-oss-20b', 'GPT OSS 20B', 'groq', 75000, 300000, NULL, 'USD'),
  ('llama-3.3-70b-versatile', 'Llama 3.3 70B', 'groq', 590000, 790000, NULL, 'USD'),
  ('MiniMax-M3', 'MiniMax M3', 'minimax_intl', 300000, 1200000, 60000, 'USD'),
  ('MiniMax-M2.7', 'MiniMax M2.7', 'minimax_intl', 300000, 1200000, 60000, 'USD'),
  ('MiniMax-M2.7-highspeed', 'MiniMax M2.7 Highspeed', 'minimax_intl', 600000, 2400000, 60000, 'USD'),
  ('grok-4.5', 'Grok 4.5', 'xai', 2000000, 6000000, 300000, 'USD'),
  ('grok-4.3', 'Grok 4.3', 'xai', 1250000, 2500000, 200000, 'USD'),
  ('mistral-large-2512', 'Mistral Large 3', 'mistral', 500000, 1500000, NULL, 'USD'),
  ('mistral-medium-3-5', 'Mistral Medium 3.5', 'mistral', 1500000, 7500000, NULL, 'USD'),
  ('mistral-small-2603', 'Mistral Small 4', 'mistral', 150000, 600000, NULL, 'USD'),
  ('gpt-5.4', 'GPT-5.4', 'openai', 2500000, 15000000, 250000, 'USD'),
  ('gpt-5.4-mini', 'GPT-5.4 mini', 'openai', 750000, 4500000, 75000, 'USD'),
  ('gpt-5.4-nano', 'GPT-5.4 nano', 'openai', 200000, 1250000, 20000, 'USD'),
  ('claude-opus-5', 'Claude Opus 5', 'anthropic', 5000000, 25000000, 500000, 'USD'),
  ('claude-sonnet-5', 'Claude Sonnet 5', 'anthropic', 3000000, 15000000, 300000, 'USD');
