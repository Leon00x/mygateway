/**
 * Admin usage API handlers.
 */

import { Env } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { getOverview, getUsageRange } from '../db/usage.ts';

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
  const overview = await getOverview(env.DB, start, end);
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
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cost_micros), 0) AS cost_micros
      FROM usage_minutes
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
      FROM usage_minutes
      WHERE timestamp_minute >= ? AND timestamp_minute < ?
      GROUP BY channel_id, channel_name_snapshot`,
    )
    .bind(start, end)
    .all();

  return json({ range, channels: result.results });
}

/**
 * DELETE /admin/api/usage
 */
export async function handleUsageClear(
  env: Env,
  requestId: string,
): Promise<Response> {
  await env.DB.prepare('DELETE FROM usage_minutes').run();
  return json({ ok: true });
}
