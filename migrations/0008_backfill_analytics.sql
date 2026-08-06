-- Migration: 0008_backfill_analytics
-- One-time backfill: roll usage_minutes (1-minute buckets, no key dimension)
-- into analytics_minutes (5-minute buckets, key_id = '') so pre-upgrade usage
-- history remains visible in the new Analytics views.
--
-- usage_minutes is kept as an archive and is no longer written by the
-- gateway; it decays via the existing retention cleanup.

INSERT OR IGNORE INTO analytics_minutes (
  timestamp_minute, model_card_id, unified_model_id_snapshot,
  channel_id, channel_name_snapshot, key_id,
  request_count, success_count, error_count, cancelled_count,
  fallback_count, attempt_count_total,
  input_tokens, output_tokens, usage_unknown_count, cost_micros,
  latency_ms_sum, latency_ms_count, ttft_ms_sum, ttft_ms_count
)
SELECT
  (timestamp_minute / 300) * 300 AS bucket,
  model_card_id,
  MAX(unified_model_id_snapshot),
  channel_id,
  MAX(channel_name_snapshot),
  '',
  SUM(request_count), SUM(success_count), SUM(error_count), SUM(cancelled_count),
  SUM(fallback_count), SUM(attempt_count_total),
  SUM(input_tokens), SUM(output_tokens), SUM(usage_unknown_count), SUM(cost_micros),
  0, 0, 0, 0
FROM usage_minutes
GROUP BY bucket, model_card_id, channel_id;
