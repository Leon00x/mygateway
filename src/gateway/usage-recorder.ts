/**
 * Request accounting: aggregate analytics, per-key daily usage, and optional
 * request log are all submitted via a single D1 batch() inside waitUntil so
 * the upstream response is never blocked.
 *
 * Analytics (5-min buckets) and key_daily_usage are always recorded.
 * request_logs is gated by the master switch and level policy.
 * Context is encrypted only when log_context is explicitly enabled.
 */

import { Env } from '../env.ts';
import { generateId } from '../shared/ids.ts';
import { computeCostMicros } from '../shared/cost.ts';
import { utcDateString, type RequestLogStatus } from '../db/requests.ts';
import { fiveMinuteFloor, type AnalyticsDelta } from '../db/analytics.ts';
import { bumpKeyQuotaLedger } from './key-quota.ts';
import { deriveContextKey, encryptContext, type EncryptedContext } from '../crypto/context-encrypt.ts';
import type { LogPolicy } from './log-policy.ts';
import type { Usage } from '../streaming/sse-decoder.ts';

export interface UsageRecordContext {
  modelCardId: string;
  unifiedModelId: string;
  channelId: string;
  channelName: string;
  inputPriceMicrosPerMillion: number | null;
  outputPriceMicrosPerMillion: number | null;
  cacheInputPriceMicrosPerMillion: number | null;
  attemptCount: number;
  fallbackOccurred: boolean;
  stream: boolean;
  cached: boolean;
  keyId: string;
  keyName: string;
  requestId: string;
  /** Request-log level policy (only gates the detail log, never usage/budget). */
  policy: LogPolicy;
  /** Client-requested protocol (openai_chat / openai_responses / anthropic_messages). */
  requestedProtocol?: string;
  /** TTFT in ms — only recorded for streaming requests with valid first output. */
  ttftMs?: number;
  /** Request context preview (max 4 KiB) — encrypted only if logContext is on. */
  contextRequest?: string;
  /** Response context preview (max 4 KiB) — encrypted only if logContext is on. */
  contextResponse?: string;
}

export type RecordOutcome = 'success' | 'error' | 'cancelled';

function outcomeStatus(outcome: RecordOutcome): RequestLogStatus {
  if (outcome === 'success') return 'success';
  return outcome === 'error' ? 'error' : 'cancelled';
}

/** Submit analytics + key usage + optional log as one D1 batch in a waitUntil. */
export async function recordRequestCompletion(
  env: Env,
  ctx: UsageRecordContext,
  outcome: RecordOutcome,
  usage: Usage | null,
  latencyMs: number,
  errorDetail?: string,
): Promise<void> {
  const inputTokens = usage?.inputTokens ?? 0;
  const cacheInputTokens = Math.max(0, Math.min(inputTokens, usage?.cacheTokens ?? 0));
  const cacheHit = ctx.cached || cacheInputTokens > 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const costMicros = computeCostMicros(
    inputTokens,
    outputTokens,
    ctx.inputPriceMicrosPerMillion,
    ctx.outputPriceMicrosPerMillion,
    cacheInputTokens,
    ctx.cacheInputPriceMicrosPerMillion,
  );
  const date = utcDateString();
  const logId = generateId();

  const statements: D1PreparedStatement[] = [];

  // 1. Always: analytics 5-min bucket
  const analyticsDelta: AnalyticsDelta = {
    request_count: 1,
    success_count: outcome === 'success' ? 1 : 0,
    error_count: outcome === 'error' ? 1 : 0,
    cancelled_count: outcome === 'cancelled' ? 1 : 0,
    fallback_count: ctx.fallbackOccurred ? 1 : 0,
    attempt_count_total: ctx.attemptCount,
    input_tokens: inputTokens,
    cache_input_tokens: cacheInputTokens,
    output_tokens: outputTokens,
    usage_unknown_count: usage === null ? 1 : 0,
    cost_micros: costMicros,
    latency_ms_sum: latencyMs,
    latency_ms_count: 1,
    ttft_ms_sum: ctx.ttftMs ?? 0,
    ttft_ms_count: ctx.ttftMs !== undefined && ctx.ttftMs > 0 ? 1 : 0,
  };

  statements.push(
    env.DB.prepare(
      `INSERT INTO analytics_minutes (
        timestamp_minute, model_card_id, channel_id,
        unified_model_id_snapshot, channel_name_snapshot, key_id,
        request_count, success_count, error_count, cancelled_count,
        fallback_count, attempt_count_total,
        input_tokens, cache_input_tokens, output_tokens, usage_unknown_count, cost_micros,
        latency_ms_sum, latency_ms_count,
        ttft_ms_sum, ttft_ms_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(timestamp_minute, model_card_id, channel_id, key_id) DO UPDATE SET
        request_count = request_count + excluded.request_count,
        success_count = success_count + excluded.success_count,
        error_count = error_count + excluded.error_count,
        cancelled_count = cancelled_count + excluded.cancelled_count,
        fallback_count = fallback_count + excluded.fallback_count,
        attempt_count_total = attempt_count_total + excluded.attempt_count_total,
        input_tokens = input_tokens + excluded.input_tokens,
        cache_input_tokens = cache_input_tokens + excluded.cache_input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        usage_unknown_count = usage_unknown_count + excluded.usage_unknown_count,
        cost_micros = cost_micros + excluded.cost_micros,
        latency_ms_sum = latency_ms_sum + excluded.latency_ms_sum,
        latency_ms_count = latency_ms_count + excluded.latency_ms_count,
        ttft_ms_sum = ttft_ms_sum + excluded.ttft_ms_sum,
        ttft_ms_count = ttft_ms_count + excluded.ttft_ms_count`,
    ).bind(
      fiveMinuteFloor(Math.floor(Date.now() / 1000)),
      ctx.modelCardId,
      ctx.channelId,
      ctx.unifiedModelId,
      ctx.channelName,
      ctx.keyId,
      analyticsDelta.request_count,
      analyticsDelta.success_count,
      analyticsDelta.error_count,
      analyticsDelta.cancelled_count,
      analyticsDelta.fallback_count,
      analyticsDelta.attempt_count_total,
      analyticsDelta.input_tokens,
      analyticsDelta.cache_input_tokens,
      analyticsDelta.output_tokens,
      analyticsDelta.usage_unknown_count,
      analyticsDelta.cost_micros,
      analyticsDelta.latency_ms_sum,
      analyticsDelta.latency_ms_count,
      analyticsDelta.ttft_ms_sum,
      analyticsDelta.ttft_ms_count,
    ),
  );

  // 2. Always: key daily usage (budget authority)
  statements.push(
    env.DB.prepare(
      `INSERT INTO key_daily_usage (key_id, date, requests, input_tokens, output_tokens, cost_micros)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key_id, date) DO UPDATE SET
         requests = requests + excluded.requests,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         cost_micros = cost_micros + excluded.cost_micros`,
    ).bind(ctx.keyId, date, 1, inputTokens, outputTokens, costMicros),
  );

  bumpKeyQuotaLedger(ctx.keyId, { requests: 1, inputTokens, outputTokens, costMicros });

  // 3. Optional: request_logs row (gated by master switch + level policy)
  const status = outcomeStatus(outcome);
  const levelEnabled = status === 'success' ? ctx.policy.logSuccess : ctx.policy.logErrors;
  const shouldLog = ctx.policy.logsEnabled && levelEnabled;

  if (shouldLog) {
    // Context encryption (only if logContext is enabled)
    let reqCtx: EncryptedContext | null = null;
    let resCtx: EncryptedContext | null = null;

    if (ctx.policy.logContext && (ctx.contextRequest || ctx.contextResponse)) {
      try {
        const contextKey = await deriveContextKey(env.MASTER_KEY);
        if (ctx.contextRequest) {
          reqCtx = await encryptContext(ctx.contextRequest, contextKey, logId);
        }
        if (ctx.contextResponse) {
          resCtx = await encryptContext(ctx.contextResponse, contextKey, logId);
        }
      } catch {
        // Context encryption failure → skip context, still write the log row
      }
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO request_logs (
          id, timestamp, request_id, key_id, key_name,
          model_card_id, unified_model_id, channel_id, channel_name,
          status, stream, cached, input_tokens, output_tokens, cost_micros,
          attempt_count, fallback, latency_ms, ttft_ms, requested_protocol, error_detail,
          context_request_iv, context_request_tag, context_request_ciphertext,
          context_response_iv, context_response_tag, context_response_ciphertext
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        logId,
        Math.floor(Date.now() / 1000),
        ctx.requestId,
        ctx.keyId,
        ctx.keyName,
        ctx.modelCardId,
        ctx.unifiedModelId,
        ctx.channelId,
        ctx.channelName,
        status,
        ctx.stream ? 1 : 0,
        cacheHit ? 1 : 0,
        inputTokens,
        outputTokens,
        costMicros,
        ctx.attemptCount,
        ctx.fallbackOccurred ? 1 : 0,
        latencyMs,
        ctx.ttftMs ?? null,
        ctx.requestedProtocol ?? null,
        errorDetail ?? null,
        reqCtx?.iv ?? null,
        reqCtx?.tag ?? null,
        reqCtx?.ciphertext ?? null,
        resCtx?.iv ?? null,
        resCtx?.tag ?? null,
        resCtx?.ciphertext ?? null,
      ),
    );
  }

  // Submit all statements as a single D1 batch
  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
}

/** Record a request rejected before reaching upstream (quota / access control). */
export async function recordRejectedRequest(
  env: Env,
  ctx: {
    keyId: string;
    keyName: string;
    requestId: string;
    model: string | null;
    modelCardId: string | null;
    requestedProtocol?: string;
  },
  status: Exclude<RequestLogStatus, 'success' | 'error' | 'cancelled'>,
  latencyMs: number,
  policy: LogPolicy,
  errorDetail?: string,
): Promise<void> {
  // Rejected requests: always record analytics count (error/cancelled etc.)
  // but no key_daily_usage increment (no tokens consumed).
  const statements: D1PreparedStatement[] = [];

  // Analytics bucket for rejected (no channel/model card context for access rejections)
  if (ctx.keyId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO analytics_minutes (
          timestamp_minute, model_card_id, channel_id,
          unified_model_id_snapshot, channel_name_snapshot, key_id,
          request_count, error_count, latency_ms_sum, latency_ms_count
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, 1)
        ON CONFLICT(timestamp_minute, model_card_id, channel_id, key_id) DO UPDATE SET
          request_count = request_count + 1,
          error_count = error_count + 1,
          latency_ms_sum = latency_ms_sum + excluded.latency_ms_sum,
          latency_ms_count = latency_ms_count + 1,
          unified_model_id_snapshot = excluded.unified_model_id_snapshot`,
      ).bind(
        fiveMinuteFloor(Math.floor(Date.now() / 1000)),
        ctx.modelCardId ?? '',
        '',
        ctx.model ?? '',
        '',
        ctx.keyId,
        latencyMs,
      ),
    );
  }

  // Log row (gated by master switch + error level)
  const shouldLog = policy.logsEnabled && policy.logErrors;
  if (shouldLog) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO request_logs (
          id, timestamp, request_id, key_id, key_name,
          model_card_id, unified_model_id, channel_id, channel_name,
          status, stream, cached, input_tokens, output_tokens, cost_micros,
          attempt_count, fallback, latency_ms, ttft_ms, requested_protocol, error_detail
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        generateId(),
        Math.floor(Date.now() / 1000),
        ctx.requestId,
        ctx.keyId,
        ctx.keyName,
        ctx.modelCardId,
        ctx.model,
        null,
        null,
        status,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        latencyMs,
        null,
        ctx.requestedProtocol ?? null,
        errorDetail ?? null,
      ),
    );
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
}
