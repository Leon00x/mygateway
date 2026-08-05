/**
 * Usage statistics database operations.
 */

export interface UsageOverview {
  requests: number;
  successes: number;
  errors: number;
  cancelled: number;
  fallbacks: number;
  input_tokens: number;
  output_tokens: number;
  usage_unknown: number;
  cost_micros: number;
}

export interface UsageByModel extends UsageOverview {
  model_card_id: string;
  unified_model_id: string;
}

export interface UsageByChannel extends UsageOverview {
  channel_id: string;
  channel_name: string;
}

/**
 * Get time range boundaries in minute-precision Unix seconds.
 */
export function getUsageRange(
  range: 'today' | '7d' | '30d',
  timeZone = 'Asia/Shanghai',
  now = Date.now(),
): { start: number; end: number } {
  // End is the NEXT minute boundary so the current minute is included
  // (usage rows use minute-truncated timestamps == floor(now/60s)*60).
  const endMinute = Math.floor(now / 60_000) * 60 + 60;
  let startMinute: number;

  if (range === 'today') {
    startMinute = Math.floor(startOfDayInTimeZone(now, timeZone) / 60_000) * 60;
  } else if (range === '7d') {
    startMinute = Math.floor((now - 7 * 86_400_000) / 60_000) * 60;
  } else {
    startMinute = Math.floor((now - 30 * 86_400_000) / 60_000) * 60;
  }

  return { start: startMinute, end: endMinute };
}

function zonedParts(timestampMs: number, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestampMs));

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
}

/** Resolve local midnight to UTC, including time zones with DST transitions. */
function startOfDayInTimeZone(nowMs: number, timeZone: string): number {
  const local = zonedParts(nowMs, timeZone);
  const targetAsUtc = Date.UTC(local.year, local.month - 1, local.day);
  let candidate = targetAsUtc;

  // Re-evaluate the offset because it can differ across a DST boundary.
  for (let i = 0; i < 3; i++) {
    const observed = zonedParts(candidate, timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const next = candidate + (targetAsUtc - observedAsUtc);
    if (next === candidate) break;
    candidate = next;
  }

  return candidate;
}

export async function getOverview(
  db: D1Database,
  startMinute: number,
  endMinute: number,
): Promise<UsageOverview> {
  const result = await db
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
        COALESCE(SUM(cost_micros), 0) AS cost_micros
      FROM usage_minutes
      WHERE timestamp_minute >= ? AND timestamp_minute < ?`,
    )
    .bind(startMinute, endMinute)
    .first<UsageOverview>();

  return (
    result ?? {
      requests: 0,
      successes: 0,
      errors: 0,
      cancelled: 0,
      fallbacks: 0,
      input_tokens: 0,
      output_tokens: 0,
      usage_unknown: 0,
      cost_micros: 0,
    }
  );
}

export async function upsertUsageMinute(
  db: D1Database,
  data: {
    timestamp_minute: number;
    model_card_id: string;
    channel_id: string;
    unified_model_id_snapshot: string;
    channel_name_snapshot: string;
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
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO usage_minutes (
        timestamp_minute, model_card_id, channel_id,
        unified_model_id_snapshot, channel_name_snapshot,
        request_count, success_count, error_count, cancelled_count,
        fallback_count, attempt_count_total,
        input_tokens, output_tokens, usage_unknown_count, cost_micros
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(timestamp_minute, model_card_id, channel_id) DO UPDATE SET
        request_count = request_count + excluded.request_count,
        success_count = success_count + excluded.success_count,
        error_count = error_count + excluded.error_count,
        cancelled_count = cancelled_count + excluded.cancelled_count,
        fallback_count = fallback_count + excluded.fallback_count,
        attempt_count_total = attempt_count_total + excluded.attempt_count_total,
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        usage_unknown_count = usage_unknown_count + excluded.usage_unknown_count,
        cost_micros = cost_micros + excluded.cost_micros`,
    )
    .bind(
      data.timestamp_minute,
      data.model_card_id,
      data.channel_id,
      data.unified_model_id_snapshot,
      data.channel_name_snapshot,
      data.request_count,
      data.success_count,
      data.error_count,
      data.cancelled_count,
      data.fallback_count,
      data.attempt_count_total,
      data.input_tokens,
      data.output_tokens,
      data.usage_unknown_count,
      data.cost_micros,
    )
    .run();
}

export async function cleanupOldUsage(
  db: D1Database,
  retentionDays: number,
): Promise<number> {
  const cutoff = Math.floor((Date.now() - retentionDays * 86_400_000) / 60_000) * 60;
  const result = await db
    .prepare('DELETE FROM usage_minutes WHERE timestamp_minute < ?')
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}
