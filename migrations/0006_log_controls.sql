-- Migration: 0006_log_controls
-- Request-log level controls + error details.

-- Both levels default to ON so existing behavior is preserved; admins can
-- turn them off from the Requests page. Usage/budget writes are unaffected.
-- The switches are stored in the existing system_settings table (migration 0001).
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('log_success', 'true'), ('log_errors', 'true');

-- Optional error context for error/cancelled/rejected log rows
-- (upstream status, error kind, truncated message — never prompt/response).
ALTER TABLE request_logs ADD COLUMN error_detail TEXT;
