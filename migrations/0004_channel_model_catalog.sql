-- Provider model discovery inventory. This is control-plane data only.

ALTER TABLE channels ADD COLUMN preset_id TEXT;
ALTER TABLE channels ADD COLUMN short_code TEXT;

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
