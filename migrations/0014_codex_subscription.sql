-- Experimental ChatGPT/Codex subscription authentication.
-- OAuth credentials are stored separately from ordinary Provider API keys.

CREATE TABLE codex_oauth_connections (
  id TEXT PRIMARY KEY,
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  account_id TEXT NOT NULL,
  email TEXT,
  plan_type TEXT,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'reauth_required')),
  refresh_lease_until INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE codex_device_flows (
  id TEXT PRIMARY KEY,
  device_auth_ciphertext TEXT NOT NULL,
  device_auth_iv TEXT NOT NULL,
  user_code TEXT NOT NULL,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 5,
  expires_at INTEGER NOT NULL,
  last_polled_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  error_summary TEXT,
  connection_id TEXT REFERENCES codex_oauth_connections(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_codex_device_flows_expiry
  ON codex_device_flows(expires_at);

ALTER TABLE channels ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'api_key'
  CHECK (auth_type IN ('api_key', 'codex_oauth'));
ALTER TABLE channels ADD COLUMN oauth_connection_id TEXT
  REFERENCES codex_oauth_connections(id) ON DELETE SET NULL;
