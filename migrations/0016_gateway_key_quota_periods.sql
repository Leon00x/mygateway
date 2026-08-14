-- Migration: 0016_gateway_key_quota_periods
-- Generalize Gateway Key request/Token budgets from daily-only to a natural
-- UTC day, ISO week (Monday), calendar month, or calendar year.

ALTER TABLE gateway_api_keys ADD COLUMN request_limit INTEGER;
ALTER TABLE gateway_api_keys ADD COLUMN token_limit INTEGER;
ALTER TABLE gateway_api_keys ADD COLUMN limit_period TEXT NOT NULL DEFAULT 'day'
  CHECK (limit_period IN ('day', 'week', 'month', 'year'));

-- Preserve every existing daily budget as a day-period budget.
UPDATE gateway_api_keys
SET request_limit = daily_request_limit,
    token_limit = daily_token_limit,
    limit_period = 'day';
