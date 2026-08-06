-- Migration: 0007_analytics
-- Analytics 5-minute aggregation buckets, context storage, new settings,
-- and cursor-pagination indexes for request_logs.

-- 5-minute aggregation: always recorded, never gated by log switches.
-- Dimensions: key, unified model, final channel. Tracks TTFT (stream only).
CREATE TABLE analytics_minutes (
  timestamp_minute INTEGER NOT NULL,  -- 5-min bucket floor (Unix seconds)
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

-- Context storage columns — only populated when log_context is enabled.
ALTER TABLE request_logs ADD COLUMN context_request_iv TEXT;
ALTER TABLE request_logs ADD COLUMN context_request_tag TEXT;
ALTER TABLE request_logs ADD COLUMN context_request_ciphertext TEXT;
ALTER TABLE request_logs ADD COLUMN context_response_iv TEXT;
ALTER TABLE request_logs ADD COLUMN context_response_tag TEXT;
ALTER TABLE request_logs ADD COLUMN context_response_ciphertext TEXT;
ALTER TABLE request_logs ADD COLUMN ttft_ms INTEGER;
ALTER TABLE request_logs ADD COLUMN requested_protocol TEXT;

-- New analytics settings.
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('request_logs_enabled', 'true');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('log_context', 'false');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('context_retention_hours', '24');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('request_log_retention_days', '7');

-- Additional composite indexes for cursor-based log pagination.
CREATE INDEX idx_request_logs_cursor ON request_logs(timestamp DESC, id DESC);
CREATE INDEX idx_request_logs_status_time ON request_logs(status, timestamp DESC);
CREATE INDEX idx_request_logs_key_time ON request_logs(key_id, timestamp DESC);
CREATE INDEX idx_request_logs_channel_time ON request_logs(channel_id, timestamp DESC);
CREATE INDEX idx_request_logs_model_time ON request_logs(unified_model_id, timestamp DESC);
