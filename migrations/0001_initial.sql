-- Migration: 0001_initial
-- Cloudflare AI Aggregation Gateway — MVP v0.1

PRAGMA foreign_keys = ON;

-- Channels (AI providers)
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
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);

CREATE INDEX idx_channels_status
  ON channels(status)
  WHERE deleted_at IS NULL;

-- Model cards (unified models)
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

-- Channel model instances
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

-- Global model identifier registry
-- Unified model IDs and full public aliases share this namespace
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

-- Gateway API keys
CREATE TABLE gateway_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);

-- Usage statistics (minute-level aggregation)
CREATE TABLE usage_minutes (
  timestamp_minute INTEGER NOT NULL,
  model_card_id TEXT NOT NULL REFERENCES model_cards(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),

  unified_model_id_snapshot TEXT NOT NULL,
  channel_name_snapshot TEXT NOT NULL,

  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  attempt_count_total INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  usage_unknown_count INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (timestamp_minute, model_card_id, channel_id)
);

CREATE INDEX idx_usage_minutes_time
  ON usage_minutes(timestamp_minute);

CREATE INDEX idx_usage_minutes_model_time
  ON usage_minutes(model_card_id, timestamp_minute);

CREATE INDEX idx_usage_minutes_channel_time
  ON usage_minutes(channel_id, timestamp_minute);

-- System settings
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
