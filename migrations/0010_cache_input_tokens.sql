-- Track provider-reported prompt cache hits separately in analytics.
-- Existing aggregates cannot be reconstructed, so historical rows default to 0.
ALTER TABLE analytics_minutes ADD COLUMN cache_input_tokens INTEGER NOT NULL DEFAULT 0;
