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

/**
 * Sum the daily authority rows for one half-open UTC calendar window.
 * The `(key_id, date)` primary key makes this a bounded range scan.
 */
export async function readKeyPeriodUsage(
  db: D1Database,
  keyId: string,
  startDate: string,
  endDate: string,
): Promise<KeyDailyUsage> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(requests), 0) AS requests,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_micros), 0) AS cost_micros
       FROM key_daily_usage
       WHERE key_id = ? AND date >= ? AND date < ?`,
    )
    .bind(keyId, startDate, endDate)
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
