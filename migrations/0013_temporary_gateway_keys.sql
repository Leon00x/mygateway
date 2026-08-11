-- Migration: 0013_temporary_gateway_keys
-- Mark one-hour Dashboard quickstart keys so they cannot be renewed and can be lazily removed.

ALTER TABLE gateway_api_keys ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0
  CHECK (is_temporary IN (0, 1));

CREATE INDEX idx_gateway_api_keys_temporary_expiry
  ON gateway_api_keys(expires_at)
  WHERE is_temporary = 1;
