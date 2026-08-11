-- Migration: 0012_management_keys
-- Scoped machine credentials for the versioned Management API.

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
