/**
 * Per-key daily usage aggregation and recent request spend logs.
 */

export interface KeyDailyUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}

export function utcDateString(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function readKeyDailyUsage(
  db: D1Database,
  keyId: string,
  date: string,
): Promise<KeyDailyUsage> {
  const row = await db
    .prepare(
      'SELECT requests, input_tokens, output_tokens, cost_micros FROM key_daily_usage WHERE key_id = ? AND date = ?',
    )
    .bind(keyId, date)
    .first<{ requests: number; input_tokens: number; output_tokens: number; cost_micros: number }>();
  return {
    requests: Number(row?.requests ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    costMicros: Number(row?.cost_micros ?? 0),
  };
}

export async function upsertKeyDailyUsage(
  db: D1Database,
  keyId: string,
  date: string,
  delta: { requests: number; inputTokens: number; outputTokens: number; costMicros: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO key_daily_usage (key_id, date, requests, input_tokens, output_tokens, cost_micros)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key_id, date) DO UPDATE SET
         requests = requests + excluded.requests,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         cost_micros = cost_micros + excluded.cost_micros`,
    )
    .bind(keyId, date, delta.requests, delta.inputTokens, delta.outputTokens, delta.costMicros)
    .run();
}

export type RequestLogStatus =
  | 'success'
  | 'error'
  | 'cancelled'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'not_allowed'
  | 'expired';

export interface RequestLogInput {
  id: string;
  timestamp: number;
  requestId: string | null;
  keyId: string | null;
  keyName: string | null;
  modelCardId: string | null;
  unifiedModelId: string | null;
  channelId: string | null;
  channelName: string | null;
  status: RequestLogStatus;
  stream: boolean;
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  attemptCount: number;
  fallback: boolean;
  latencyMs: number;
}

export interface RequestLogRow {
  id: string;
  timestamp: number;
  request_id: string | null;
  key_id: string | null;
  key_name: string | null;
  model_card_id: string | null;
  unified_model_id: string | null;
  channel_id: string | null;
  channel_name: string | null;
  status: RequestLogStatus;
  stream: number;
  cached: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  attempt_count: number;
  fallback: number;
  latency_ms: number;
}

export async function insertRequestLog(
  db: D1Database,
  entry: RequestLogInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO request_logs (
        id, timestamp, request_id, key_id, key_name,
        model_card_id, unified_model_id, channel_id, channel_name,
        status, stream, cached, input_tokens, output_tokens, cost_micros,
        attempt_count, fallback, latency_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.id,
      entry.timestamp,
      entry.requestId,
      entry.keyId,
      entry.keyName,
      entry.modelCardId,
      entry.unifiedModelId,
      entry.channelId,
      entry.channelName,
      entry.status,
      entry.stream ? 1 : 0,
      entry.cached ? 1 : 0,
      entry.inputTokens,
      entry.outputTokens,
      entry.costMicros,
      entry.attemptCount,
      entry.fallback ? 1 : 0,
      entry.latencyMs,
    )
    .run();
}

export interface RequestLogQuery {
  limit: number;
  keyId?: string;
  status?: RequestLogStatus | 'all';
}

export async function listRequestLogs(
  db: D1Database,
  query: RequestLogQuery,
): Promise<RequestLogRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (query.keyId) {
    conditions.push('key_id = ?');
    values.push(query.keyId);
  }
  if (query.status && query.status !== 'all') {
    conditions.push('status = ?');
    values.push(query.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(query.limit, 1), 200);
  values.push(limit);
  const result = await db
    .prepare(
      `SELECT * FROM request_logs ${where} ORDER BY timestamp DESC, id DESC LIMIT ?`,
    )
    .bind(...values)
    .all<RequestLogRow>();
  return result.results;
}

export async function cleanupRequestLogs(
  db: D1Database,
  retentionDays: number,
): Promise<number> {
  const cutoff = Math.floor((Date.now() - retentionDays * 86_400_000) / 1000);
  const result = await db
    .prepare('DELETE FROM request_logs WHERE timestamp < ?')
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}

export async function cleanupKeyDailyUsage(db: D1Database, retentionDays: number): Promise<number> {
  const cutoff = utcDateString(Date.now() - retentionDays * 86_400_000);
  const result = await db
    .prepare('DELETE FROM key_daily_usage WHERE date < ?')
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}
