/**
 * Admin Analytics API handlers — Usage, Logs, Settings.
 */

import { Env } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { json } from './router.ts';
import { setSetting } from '../db/settings.ts';
import { invalidateLogPolicyCache } from '../gateway/log-policy.ts';
import { getUsageRange } from '../db/usage.ts';
import {
  queryAnalyticsUsage,
  queryLogsCursor,
  getLogById,
  clearAllLogs,
  readAnalyticsSettings,
} from '../db/analytics.ts';
import { deriveContextKey, decryptContext } from '../crypto/context-encrypt.ts';
import type { RequestLogStatus } from '../db/requests.ts';

// ---- Helpers ----

/**
 * Resolve the query window. Named ranges use the same timezone as the rest of
 * the app (DEFAULT_TIMEZONE, default Asia/Shanghai) so the "today" boundary
 * matches the dashboard; custom start/end are raw Unix seconds.
 */
function parseRange(url: URL, env: Env): { start: number; end: number } {
  const range = url.searchParams.get('range') ?? 'today';
  if (range === 'today' || range === '7d' || range === '30d') {
    return getUsageRange(range, env.DEFAULT_TIMEZONE ?? 'Asia/Shanghai');
  }
  if (range === 'yesterday') {
    const today = getUsageRange('today', env.DEFAULT_TIMEZONE ?? 'Asia/Shanghai');
    return { start: today.start - 86_400, end: today.start };
  }

  // Custom: try start/end params (Unix seconds)
  const now = Date.now();
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  const start = startParam ? parseInt(startParam, 10) : Math.floor((now - 86_400_000) / 1000);
  const end = endParam ? parseInt(endParam, 10) : Math.floor(now / 1000);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function parseStatus(value: string | null): RequestLogStatus | 'all' {
  if (!value) return 'all';
  const statuses: RequestLogStatus[] = [
    'success', 'error', 'cancelled', 'rate_limited', 'budget_exceeded', 'not_allowed', 'expired',
  ];
  return (statuses as string[]).includes(value) ? value as RequestLogStatus : 'all';
}

function parseLimit(value: string | null, max = 100): number {
  const n = parseInt(value ?? '50', 10);
  return Math.min(Math.max(isNaN(n) ? 50 : n, 1), max);
}

// ---- GET /admin/api/analytics/usage ----

export async function handleAnalyticsUsage(
  _request: Request,
  url: URL,
  env: Env,
  requestId: string,
): Promise<Response> {
  const { start, end } = parseRange(url, env);
  const modelId = url.searchParams.get('model_id') ?? undefined;
  const keyId = url.searchParams.get('key_id') ?? undefined;
  const granularityParam = url.searchParams.get('granularity');
  const granularity = granularityParam === 'hour' || granularityParam === 'day'
    ? granularityParam
    : undefined;

  try {
    const result = await queryAnalyticsUsage(env.DB, { start, end, modelId, keyId, granularity });
    return json({
      range: { start, end },
      summary: result.summary,
      models: result.models,
      trends: result.trends,
    });
  } catch (e) {
    return gatewayErrorResponse('upstream_error', 'Failed to query analytics', requestId);
  }
}

// ---- GET /admin/api/analytics/logs ----

export async function handleAnalyticsLogs(
  _request: Request,
  url: URL,
  env: Env,
  requestId: string,
): Promise<Response> {
  try {
    const isExport = url.searchParams.get('export') === '1';
    const limit = isExport ? 10_000 : parseLimit(url.searchParams.get('limit'));
    const cursorTs = url.searchParams.get('cursor_ts');
    const cursorId = url.searchParams.get('cursor_id');
    const cursor = cursorTs && cursorId
      ? { timestamp: parseInt(cursorTs, 10), id: cursorId }
      : undefined;
    const startTime = url.searchParams.get('start') ? parseInt(url.searchParams.get('start')!, 10) : undefined;
    const endTime = url.searchParams.get('end') ? parseInt(url.searchParams.get('end')!, 10) : undefined;
    const modelId = url.searchParams.get('model_id') ?? undefined;
    const keyId = url.searchParams.get('key_id') ?? undefined;
    const channelId = url.searchParams.get('channel_id') ?? undefined;
    const status = parseStatus(url.searchParams.get('status'));
    const exactRequestId = url.searchParams.get('request_id') ?? undefined;

    const result = await queryLogsCursor(env.DB, {
      limit,
      cursor,
      startTime,
      endTime,
      modelId,
      keyId,
      channelId,
      status,
      requestId: exactRequestId,
    });

    if (isExport) {
      return exportLogsCsv(result.rows, requestId);
    }

    // Sanitize: never return context columns in list responses
    const rows = result.rows.map((row) => {
      const { context_request_iv, context_request_tag, context_request_ciphertext, context_response_iv, context_response_tag, context_response_ciphertext, ...safe } = row as Record<string, unknown>;
      return safe;
    });

    return json({
      logs: rows,
      next_cursor: result.nextCursor,
    });
  } catch (e) {
    return gatewayErrorResponse('upstream_error', 'Failed to query logs', requestId);
  }
}

/** Build a CSV export from raw log rows (metadata only, no context columns). */
function exportLogsCsv(rows: Array<Record<string, unknown>>, requestId: string): Response {
  const header = ['timestamp', 'request_id', 'key_name', 'unified_model_id', 'channel_name', 'status', 'stream', 'input_tokens', 'output_tokens', 'cost_micros', 'attempt_count', 'fallback', 'latency_ms', 'ttft_ms', 'error_detail'];
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((h) => esc(row[h])).join(','));
  }
  const fileName = `mygateway-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(`\uFEFF${lines.join('\n')}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'x-gateway-request-id': requestId,
    },
  });
}

// ---- GET /admin/api/analytics/logs/:id ----

export async function handleAnalyticsLogDetail(
  _request: Request,
  id: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  try {
    const row = await getLogById(env.DB, id);
    if (!row) {
      return gatewayErrorResponse('invalid_request', 'Log entry not found', requestId);
    }

    // Decrypt context if present
    let contextRequest: string | null = null;
    let contextResponse: string | null = null;

    if (row.context_request_ciphertext && row.context_request_iv && row.context_request_tag) {
      try {
        const contextKey = await deriveContextKey(env.MASTER_KEY);
        contextRequest = await decryptContext(
          { iv: row.context_request_iv as string, tag: row.context_request_tag as string, ciphertext: row.context_request_ciphertext as string },
          contextKey,
          id,
        );
      } catch { /* decryption failure */ }
    }

    if (row.context_response_ciphertext && row.context_response_iv && row.context_response_tag) {
      try {
        const contextKey = await deriveContextKey(env.MASTER_KEY);
        contextResponse = await decryptContext(
          { iv: row.context_response_iv as string, tag: row.context_response_tag as string, ciphertext: row.context_response_ciphertext as string },
          contextKey,
          id,
        );
      } catch { /* decryption failure */ }
    }

    // Remove raw crypto columns from output
    const { context_request_iv, context_request_tag, context_request_ciphertext, context_response_iv, context_response_tag, context_response_ciphertext, ...safe } = row as Record<string, unknown>;

    return json({
      ...safe,
      context_request: contextRequest,
      context_response: contextResponse,
    });
  } catch (e) {
    return gatewayErrorResponse('upstream_error', 'Failed to fetch log detail', requestId);
  }
}

// ---- DELETE /admin/api/analytics/logs ----

export async function handleAnalyticsLogsClear(
  _request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  try {
    const count = await clearAllLogs(env.DB);
    return json({ ok: true, deleted: count });
  } catch (e) {
    return gatewayErrorResponse('upstream_error', 'Failed to clear logs', requestId);
  }
}

// ---- GET/PUT /admin/api/analytics/settings ----

export async function handleAnalyticsSettings(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const settings = await readAnalyticsSettings(env.DB);
    return json(settings);
  }

  if (request.method === 'PUT') {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const currentSettings = await readAnalyticsSettings(env.DB);

      // Validate retention constraints
      const logDays = body.request_log_retention_days !== undefined
        ? Number(body.request_log_retention_days) : undefined;
      const ctxHours = body.context_retention_hours !== undefined
        ? Number(body.context_retention_hours) : undefined;

      // log retention: only 1, 3, 7 days
      if (logDays !== undefined && ![1, 3, 7].includes(logDays)) {
        return gatewayErrorResponse('invalid_request', 'request_log_retention_days must be 1, 3, or 7', requestId);
      }
      // context retention: 1-168 hours, must not exceed log retention
      if (ctxHours !== undefined) {
        if (ctxHours < 1 || ctxHours > 168) {
          return gatewayErrorResponse('invalid_request', 'context_retention_hours must be between 1 and 168', requestId);
        }
        const effectiveLogDays = logDays ?? currentSettings.requestLogRetentionDays;
        if (ctxHours > effectiveLogDays * 24) {
          return gatewayErrorResponse('invalid_request', 'context_retention_hours must not exceed request_log_retention_days', requestId);
        }
      }

      const effectiveContextHours = ctxHours ?? currentSettings.contextRetentionHours;
      if (logDays !== undefined && effectiveContextHours > logDays * 24) {
        return gatewayErrorResponse(
          'invalid_request',
          'request_log_retention_days must not be shorter than context_retention_hours',
          requestId,
        );
      }

      const allowedKeys = [
        'request_logs_enabled', 'log_success', 'log_errors',
        'log_context', 'context_retention_hours', 'request_log_retention_days',
      ];

      for (const [key, value] of Object.entries(body)) {
        if (!allowedKeys.includes(key)) continue;
        if (['request_logs_enabled', 'log_success', 'log_errors', 'log_context'].includes(key)) {
          if (typeof value !== 'boolean') {
            return gatewayErrorResponse('invalid_request', `${key} must be a boolean`, requestId);
          }
          await setSetting(env.DB, key, String(value));
        } else {
          const num = Number(value);
          if (isNaN(num) || num <= 0) {
            return gatewayErrorResponse('invalid_request', `${key} must be a positive number`, requestId);
          }
          await setSetting(env.DB, key, String(num));
        }
      }

      invalidateLogPolicyCache();
      const settings = await readAnalyticsSettings(env.DB);
      return json({ ok: true, ...settings });
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}
