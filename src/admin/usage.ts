/**
 * Admin usage API handlers — now reads from analytics_minutes for backward compat.
 */

import { Env } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { getUsageRange } from '../db/usage.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseRange(url: URL): 'today' | '7d' | '30d' {
  const range = url.searchParams.get('range');
  if (range === 'today' || range === '7d' || range === '30d') return range;
  return 'today';
}

function usageRange(range: 'today' | '7d' | '30d', env: Env) {
  return getUsageRange(range, env.DEFAULT_TIMEZONE ?? 'Asia/Shanghai');
}

/**
 * GET /admin/api/usage/overview?range=today|7d|30d
 */
export async function handleUsageOverview(
  url: URL,
  env: Env,
  requestId: string,
): Promise<Response> {
  const range = parseRange(url);
  const { start, end } = usageRange(range, env);
  const overview = await env.DB
    .prepare(
      `SELECT
        COALESCE(SUM(request_count), 0) AS requests,
        COALESCE(SUM(success_count), 0) AS successes,
        COALESCE(SUM(error_count), 0) AS errors,
        COALESCE(SUM(cancelled_count), 0) AS cancelled,
        COALESCE(SUM(fallback_count), 0) AS fallbacks,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(cache_input_tokens), 0) AS cache_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(usage_unknown_count), 0) AS usage_unknown,
        COALESCE(SUM(cost_micros), 0) AS cost_micros
      FROM analytics_minutes
      WHERE timestamp_minute >= ? AND timestamp_minute < ?`,
    )
    .bind(start, end)
    .first<{
      requests: number; successes: number; errors: number; cancelled: number;
      fallbacks: number; input_tokens: number; cache_input_tokens: number;
      output_tokens: number; usage_unknown: number; cost_micros: number;
    }>()
    .then((r) => ({
      requests: Number(r?.requests ?? 0),
      successes: Number(r?.successes ?? 0),
      errors: Number(r?.errors ?? 0),
      cancelled: Number(r?.cancelled ?? 0),
      fallbacks: Number(r?.fallbacks ?? 0),
      input_tokens: Number(r?.input_tokens ?? 0),
      cache_input_tokens: Number(r?.cache_input_tokens ?? 0),
      output_tokens: Number(r?.output_tokens ?? 0),
      usage_unknown: Number(r?.usage_unknown ?? 0),
      cost_micros: Number(r?.cost_micros ?? 0),
    }));
  return json({ range, ...overview });
}

/**
 * GET /admin/api/usage/by-model?range=...
 */
export async function handleUsageByModel(
  url: URL,
  env: Env,
  requestId: string,
): Promise<Response> {
  const range = parseRange(url);
  const { start, end } = usageRange(range, env);

  const result = await env.DB
    .prepare(
      `SELECT
        model_card_id,
        unified_model_id_snapshot AS unified_model_id,
        COALESCE(SUM(request_count), 0) AS requests,
        COALESCE(SUM(success_count), 0) AS successes,
        COALESCE(SUM(error_count), 0) AS errors,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(cache_input_tokens), 0) AS cache_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cost_micros), 0) AS cost_micros
      FROM analytics_minutes
      WHERE timestamp_minute >= ? AND timestamp_minute < ?
      GROUP BY model_card_id, unified_model_id_snapshot`,
    )
    .bind(start, end)
    .all();

  return json({ range, models: result.results });
}

/**
 * GET /admin/api/usage/by-channel?range=...
 */
export async function handleUsageByChannel(
  url: URL,
  env: Env,
  requestId: string,
): Promise<Response> {
  const range = parseRange(url);
  const { start, end } = usageRange(range, env);

  const result = await env.DB
    .prepare(
      `SELECT
        channel_id,
        channel_name_snapshot AS channel_name,
        COALESCE(SUM(request_count), 0) AS requests,
        COALESCE(SUM(success_count), 0) AS successes,
        COALESCE(SUM(error_count), 0) AS errors,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cost_micros), 0) AS cost_micros
      FROM analytics_minutes
      WHERE timestamp_minute >= ? AND timestamp_minute < ?
      GROUP BY channel_id, channel_name_snapshot`,
    )
    .bind(start, end)
    .all();

  return json({ range, channels: result.results });
}

/**
 * DELETE /admin/api/usage — clears both analytics_minutes and usage_minutes.
 */
export async function handleUsageClear(
  env: Env,
  requestId: string,
): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM usage_minutes'),
    env.DB.prepare('DELETE FROM analytics_minutes'),
  ]);
  return json({ ok: true });
}
