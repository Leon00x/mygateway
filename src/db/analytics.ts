/**
 * Analytics database operations — 5-minute aggregation buckets and
 * cursor-paginated request_logs queries.
 */

import type { RequestLogStatus } from './requests.ts';

// ---- Analytics 5-min bucket ----

/** Round a Unix timestamp (seconds) down to the nearest 5-minute boundary. */
export function fiveMinuteFloor(ts: number): number {
  return Math.floor(ts / 300) * 300;
}

export interface AnalyticsDelta {
  request_count: number;
  success_count: number;
  error_count: number;
  cancelled_count: number;
  fallback_count: number;
  attempt_count_total: number;
  input_tokens: number;
  output_tokens: number;
  usage_unknown_count: number;
  cost_micros: number;
  latency_ms_sum: number;
  latency_ms_count: number;
  ttft_ms_sum: number;
  ttft_ms_count: number;
}

export async function upsertAnalyticsMinute(
  db: D1Database,
  bucket: {
    timestamp_minute: number;
    model_card_id: string;
    channel_id: string;
    unified_model_id: string;
    channel_name: string;
    key_id: string;
  },
  delta: AnalyticsDelta,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO analytics_minutes (
        timestamp_minute, model_card_id, channel_id,
        unified_model_id_snapshot, channel_name_snapshot, key_id,
        request_count, success_count, error_count, cancelled_count,
        fallback_count, attempt_count_total,
        input_tokens, output_tokens, usage_unknown_count, cost_micros,
        latency_ms_sum, latency_ms_count,
        ttft_ms_sum, ttft_ms_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(timestamp_minute, model_card_id, channel_id, key_id) DO UPDATE SET
        request_count = request_count + excluded.request_count,
        success_count = success_count + excluded.success_count,
        error_count = error_count + excluded.error_count,
        cancelled_count = cancelled_count + excluded.cancelled_count,
        fallback_count = fallback_count + excluded.fallback_count,
        attempt_count_total = attempt_count_total + excluded.attempt_count_total,
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        usage_unknown_count = usage_unknown_count + excluded.usage_unknown_count,
        cost_micros = cost_micros + excluded.cost_micros,
        latency_ms_sum = latency_ms_sum + excluded.latency_ms_sum,
        latency_ms_count = latency_ms_count + excluded.latency_ms_count,
        ttft_ms_sum = ttft_ms_sum + excluded.ttft_ms_sum,
        ttft_ms_count = ttft_ms_count + excluded.ttft_ms_count`,
    )
    .bind(
      bucket.timestamp_minute,
      bucket.model_card_id,
      bucket.channel_id,
      bucket.unified_model_id,
      bucket.channel_name,
      bucket.key_id,
      delta.request_count,
      delta.success_count,
      delta.error_count,
      delta.cancelled_count,
      delta.fallback_count,
      delta.attempt_count_total,
      delta.input_tokens,
      delta.output_tokens,
      delta.usage_unknown_count,
      delta.cost_micros,
      delta.latency_ms_sum,
      delta.latency_ms_count,
      delta.ttft_ms_sum,
      delta.ttft_ms_count,
    )
    .run();
}

// ---- Analytics Usage Query ----

export interface AnalyticsUsageSummary {
  requests: number;
  successes: number;
  errors: number;
  cancelled: number;
  fallbacks: number;
  input_tokens: number;
  output_tokens: number;
  usage_unknown: number;
  cost_micros: number;
  avg_latency_ms: number | null;
  avg_ttft_ms: number | null;
  ttft_count: number;
  latency_count: number;
}

export interface AnalyticsModelRow extends AnalyticsUsageSummary {
  model_card_id: string;
  unified_model_id: string;
}

export interface AnalyticsTrendPoint {
  bucket: number; // Unix seconds (5-min floor)
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
}

export async function queryAnalyticsUsage(
  db: D1Database,
  params: {
    start: number;
    end: number;
    modelId?: string;
    keyId?: string;
    granularity?: 'hour' | 'day';
  },
): Promise<{
  summary: AnalyticsUsageSummary;
  models: AnalyticsModelRow[];
  trends: AnalyticsTrendPoint[];
}> {
  const conditions: string[] = ['timestamp_minute >= ?', 'timestamp_minute < ?'];
  const values: unknown[] = [params.start, params.end];

  if (params.modelId) {
    conditions.push('unified_model_id_snapshot = ?');
    values.push(params.modelId);
  }
  if (params.keyId) {
    conditions.push('key_id = ?');
    values.push(params.keyId);
  }
  const where = conditions.join(' AND ');

  // Summary
  const summaryRow = await db
    .prepare(
      `SELECT
        COALESCE(SUM(request_count), 0) AS requests,
        COALESCE(SUM(success_count), 0) AS successes,
        COALESCE(SUM(error_count), 0) AS errors,
        COALESCE(SUM(cancelled_count), 0) AS cancelled,
        COALESCE(SUM(fallback_count), 0) AS fallbacks,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(usage_unknown_count), 0) AS usage_unknown,
        COALESCE(SUM(cost_micros), 0) AS cost_micros,
        COALESCE(SUM(latency_ms_sum), 0) AS latency_ms_sum,
        COALESCE(SUM(latency_ms_count), 0) AS latency_ms_count,
        COALESCE(SUM(ttft_ms_sum), 0) AS ttft_ms_sum,
        COALESCE(SUM(ttft_ms_count), 0) AS ttft_ms_count
      FROM analytics_minutes
      WHERE ${where}`,
    )
    .bind(...values)
    .first<{
      requests: number; successes: number; errors: number; cancelled: number; fallbacks: number;
      input_tokens: number; output_tokens: number; usage_unknown: number; cost_micros: number;
      latency_ms_sum: number; latency_ms_count: number;
      ttft_ms_sum: number; ttft_ms_count: number;
    }>();

  const s = summaryRow ?? { requests: 0, successes: 0, errors: 0, cancelled: 0, fallbacks: 0, input_tokens: 0, output_tokens: 0, usage_unknown: 0, cost_micros: 0, latency_ms_sum: 0, latency_ms_count: 0, ttft_ms_sum: 0, ttft_ms_count: 0 };

  const summary: AnalyticsUsageSummary = {
    requests: Number(s.requests),
    successes: Number(s.successes),
    errors: Number(s.errors),
    cancelled: Number(s.cancelled),
    fallbacks: Number(s.fallbacks),
    input_tokens: Number(s.input_tokens),
    output_tokens: Number(s.output_tokens),
    usage_unknown: Number(s.usage_unknown),
    cost_micros: Number(s.cost_micros),
    avg_latency_ms: Number(s.latency_ms_count) > 0 ? Math.round(Number(s.latency_ms_sum) / Number(s.latency_ms_count)) : null,
    avg_ttft_ms: Number(s.ttft_ms_count) > 0 ? Math.round(Number(s.ttft_ms_sum) / Number(s.ttft_ms_count)) : null,
    ttft_count: Number(s.ttft_ms_count),
    latency_count: Number(s.latency_ms_count),
  };

  // By-model breakdown
  const modelRows = await db
    .prepare(
      `SELECT
        model_card_id,
        unified_model_id_snapshot AS unified_model_id,
        COALESCE(SUM(request_count), 0) AS requests,
        COALESCE(SUM(success_count), 0) AS successes,
        COALESCE(SUM(error_count), 0) AS errors,
        COALESCE(SUM(cancelled_count), 0) AS cancelled,
        COALESCE(SUM(fallback_count), 0) AS fallbacks,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(usage_unknown_count), 0) AS usage_unknown,
        COALESCE(SUM(cost_micros), 0) AS cost_micros,
        COALESCE(SUM(latency_ms_sum), 0) AS latency_ms_sum,
        COALESCE(SUM(latency_ms_count), 0) AS latency_ms_count,
        COALESCE(SUM(ttft_ms_sum), 0) AS ttft_ms_sum,
        COALESCE(SUM(ttft_ms_count), 0) AS ttft_ms_count
      FROM analytics_minutes
      WHERE ${where}
      GROUP BY model_card_id, unified_model_id_snapshot
      ORDER BY requests DESC
      LIMIT 100`,
    )
    .bind(...values)
    .all<{
      model_card_id: string; unified_model_id: string; requests: number; successes: number;
      errors: number; cancelled: number; fallbacks: number;
      input_tokens: number; output_tokens: number; usage_unknown: number; cost_micros: number;
      latency_ms_sum: number; latency_ms_count: number;
      ttft_ms_sum: number; ttft_ms_count: number;
    }>();

  const models: AnalyticsModelRow[] = modelRows.results.map((r) => ({
    model_card_id: r.model_card_id,
    unified_model_id: r.unified_model_id,
    requests: Number(r.requests),
    successes: Number(r.successes),
    errors: Number(r.errors),
    cancelled: Number(r.cancelled),
    fallbacks: Number(r.fallbacks),
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    usage_unknown: Number(r.usage_unknown),
    cost_micros: Number(r.cost_micros),
    avg_latency_ms: Number(r.latency_ms_count) > 0 ? Math.round(Number(r.latency_ms_sum) / Number(r.latency_ms_count)) : null,
    avg_ttft_ms: Number(r.ttft_ms_count) > 0 ? Math.round(Number(r.ttft_ms_sum) / Number(r.ttft_ms_count)) : null,
    ttft_count: Number(r.ttft_ms_count),
    latency_count: Number(r.latency_ms_count),
  }));

  // Trends (raw, hour, or day buckets)
  const trends: AnalyticsTrendPoint[] = [];
  const bucketExpr = params.granularity === 'hour'
    ? "(timestamp_minute / 3600) * 3600"
    : params.granularity === 'day'
      ? "(timestamp_minute / 86400) * 86400"
      : "timestamp_minute";
  const trendLimit = params.granularity === 'day' ? 90 : params.granularity === 'hour' ? 168 : 1440;

  const trendRows = await db
    .prepare(
      `SELECT
        ${bucketExpr} AS bucket,
        COALESCE(SUM(request_count), 0) AS requests,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cost_micros), 0) AS cost_micros
      FROM analytics_minutes
      WHERE ${where}
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT ${trendLimit}`,
    )
    .bind(...values)
    .all<{ bucket: number; requests: number; input_tokens: number; output_tokens: number; cost_micros: number }>();

  for (const r of trendRows.results) {
    trends.push({
      bucket: Number(r.bucket),
      requests: Number(r.requests),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      cost_micros: Number(r.cost_micros),
    });
  }

  return { summary, models, trends };
}

// ---- Cursor-paginated log queries ----

export interface LogQueryParams {
  limit: number;
  cursor?: { timestamp: number; id: string };
  startTime?: number;
  endTime?: number;
  modelId?: string;
  keyId?: string;
  channelId?: string;
  status?: RequestLogStatus | 'all';
  requestId?: string;
}

export interface LogQueryResult {
  rows: Array<Record<string, unknown>>;
  nextCursor: { timestamp: number; id: string } | null;
}

const LOG_COLUMNS = `id, timestamp, request_id, key_id, key_name,
  model_card_id, unified_model_id, channel_id, channel_name,
  status, stream, cached, input_tokens, output_tokens, cost_micros,
  attempt_count, fallback, latency_ms, ttft_ms, requested_protocol, error_detail`;

export async function queryLogsCursor(
  db: D1Database,
  params: LogQueryParams,
): Promise<LogQueryResult> {
  const limit = Math.min(Math.max(params.limit, 1), 100);
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.startTime !== undefined) {
    conditions.push('timestamp >= ?');
    values.push(params.startTime);
  }
  if (params.endTime !== undefined) {
    conditions.push('timestamp <= ?');
    values.push(params.endTime);
  }
  if (params.modelId) {
    conditions.push('unified_model_id = ?');
    values.push(params.modelId);
  }
  if (params.keyId) {
    conditions.push('key_id = ?');
    values.push(params.keyId);
  }
  if (params.channelId) {
    conditions.push('channel_id = ?');
    values.push(params.channelId);
  }
  if (params.status && params.status !== 'all') {
    conditions.push('status = ?');
    values.push(params.status);
  }
  if (params.requestId) {
    conditions.push('request_id = ?');
    values.push(params.requestId);
  }

  if (params.cursor) {
    conditions.push('(timestamp < ? OR (timestamp = ? AND id < ?))');
    values.push(params.cursor.timestamp, params.cursor.timestamp, params.cursor.id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // Fetch one extra to detect next page
  values.push(limit + 1);

  const result = await db
    .prepare(
      `SELECT ${LOG_COLUMNS} FROM request_logs ${where} ORDER BY timestamp DESC, id DESC LIMIT ?`,
    )
    .bind(...values)
    .all<Record<string, unknown>>();

  const rows = result.results.slice(0, limit);
  const hasMore = result.results.length > limit;
  const nextCursor = hasMore && rows.length > 0
    ? { timestamp: rows[rows.length - 1].timestamp as number, id: rows[rows.length - 1].id as string }
    : null;

  return { rows, nextCursor };
}

export async function getLogById(
  db: D1Database,
  id: string,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(`SELECT * FROM request_logs WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ?? null;
}

export async function clearAllLogs(db: D1Database): Promise<number> {
  const result = await db.prepare('DELETE FROM request_logs').run();
  return result.meta?.changes ?? 0;
}

export async function cleanupAnalytics(
  db: D1Database,
  retentionDays: number,
): Promise<number> {
  const cutoff = Math.floor((Date.now() - retentionDays * 86_400_000) / 300_000) * 300;
  const result = await db
    .prepare('DELETE FROM analytics_minutes WHERE timestamp_minute < ?')
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}

/** Nullify context columns older than retentionHours to enforce privacy window. */
export async function cleanupContext(
  db: D1Database,
  retentionHours: number,
): Promise<number> {
  const cutoff = Math.floor((Date.now() - retentionHours * 3_600_000) / 1000);
  const result = await db
    .prepare(
      `UPDATE request_logs SET
        context_request_iv = NULL, context_request_tag = NULL, context_request_ciphertext = NULL,
        context_response_iv = NULL, context_response_tag = NULL, context_response_ciphertext = NULL
      WHERE timestamp < ?
        AND (context_request_ciphertext IS NOT NULL OR context_response_ciphertext IS NOT NULL)`,
    )
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}

/** Read analytics settings from system_settings in a single bounded query. */
export async function readAnalyticsSettings(db: D1Database): Promise<{
  requestLogsEnabled: boolean;
  logSuccess: boolean;
  logErrors: boolean;
  logContext: boolean;
  contextRetentionHours: number;
  requestLogRetentionDays: number;
}> {
  const keys = ['request_logs_enabled', 'log_success', 'log_errors', 'log_context', 'context_retention_hours', 'request_log_retention_days'];
  const placeholders = keys.map(() => '?').join(',');
  const rows = await db
    .prepare(`SELECT key, value FROM system_settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();

  const results = new Map<string, string | null>();
  for (const k of keys) results.set(k, null);
  for (const row of rows.results) results.set(row.key, row.value);

  const getBool = (key: string, defaultVal: boolean) => {
    const v = results.get(key);
    if (v === null || v === undefined) return defaultVal;
    return v !== 'false';
  };

  return {
    requestLogsEnabled: getBool('request_logs_enabled', true),
    logSuccess: getBool('log_success', true),
    logErrors: getBool('log_errors', true),
    logContext: getBool('log_context', false),
    contextRetentionHours: parseInt(results.get('context_retention_hours') ?? '24', 10) || 24,
    requestLogRetentionDays: parseInt(results.get('request_log_retention_days') ?? '7', 10) || 7,
  };
}
