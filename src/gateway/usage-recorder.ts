/**
 * Request accounting: aggregate usage, per-key daily usage, and the recent
 * request spend log are all written from one place so the numbers agree.
 */

import { Env } from '../env.ts';
import { generateId, nowMinute } from '../shared/ids.ts';
import { computeCostMicros } from '../shared/cost.ts';
import { upsertUsageMinute } from '../db/usage.ts';
import { insertRequestLog, upsertKeyDailyUsage, utcDateString, type RequestLogStatus } from '../db/requests.ts';
import type { Usage } from '../streaming/sse-decoder.ts';

export interface UsageRecordContext {
  modelCardId: string;
  unifiedModelId: string;
  channelId: string;
  channelName: string;
  inputPriceMicrosPerMillion: number | null;
  outputPriceMicrosPerMillion: number | null;
  attemptCount: number;
  fallbackOccurred: boolean;
  stream: boolean;
  cached: boolean;
  keyId: string;
  keyName: string;
  requestId: string;
}

export type RecordOutcome = 'success' | 'error' | 'cancelled';

function outcomeStatus(outcome: RecordOutcome): RequestLogStatus {
  if (outcome === 'success') return 'success';
  return outcome === 'error' ? 'error' : 'cancelled';
}

/** Record a request that reached an upstream decision (success / error / cancel). */
export async function recordRequestCompletion(
  env: Env,
  ctx: UsageRecordContext,
  outcome: RecordOutcome,
  usage: Usage | null,
  latencyMs: number,
): Promise<void> {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const costMicros = computeCostMicros(
    inputTokens,
    outputTokens,
    ctx.inputPriceMicrosPerMillion,
    ctx.outputPriceMicrosPerMillion,
  );
  const date = utcDateString();

  await upsertUsageMinute(env.DB, {
    timestamp_minute: nowMinute(),
    model_card_id: ctx.modelCardId,
    channel_id: ctx.channelId,
    unified_model_id_snapshot: ctx.unifiedModelId,
    channel_name_snapshot: ctx.channelName,
    request_count: 1,
    success_count: outcome === 'success' ? 1 : 0,
    error_count: outcome === 'error' ? 1 : 0,
    cancelled_count: outcome === 'cancelled' ? 1 : 0,
    fallback_count: ctx.fallbackOccurred ? 1 : 0,
    attempt_count_total: ctx.attemptCount,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    usage_unknown_count: usage === null ? 1 : 0,
    cost_micros: costMicros,
  });

  await upsertKeyDailyUsage(env.DB, ctx.keyId, date, {
    requests: 1,
    inputTokens,
    outputTokens,
    costMicros,
  });

  await insertRequestLog(env.DB, {
    id: generateId(),
    timestamp: Math.floor(Date.now() / 1000),
    requestId: ctx.requestId,
    keyId: ctx.keyId,
    keyName: ctx.keyName,
    modelCardId: ctx.modelCardId,
    unifiedModelId: ctx.unifiedModelId,
    channelId: ctx.channelId,
    channelName: ctx.channelName,
    status: outcomeStatus(outcome),
    stream: ctx.stream,
    cached: ctx.cached,
    inputTokens,
    outputTokens,
    costMicros,
    attemptCount: ctx.attemptCount,
    fallback: ctx.fallbackOccurred,
    latencyMs,
  });
}

/**
 * A cached response is logged but not billed again (the original upstream
 * call already paid for it), so usage aggregates and budgets are unaffected.
 */
export async function recordCachedHit(
  env: Env,
  ctx: Pick<UsageRecordContext, 'modelCardId' | 'unifiedModelId' | 'keyId' | 'keyName' | 'requestId'>,
  cached: { inputTokens: number; outputTokens: number },
  latencyMs: number,
): Promise<void> {
  await insertRequestLog(env.DB, {
    id: generateId(),
    timestamp: Math.floor(Date.now() / 1000),
    requestId: ctx.requestId,
    keyId: ctx.keyId,
    keyName: ctx.keyName,
    modelCardId: ctx.modelCardId,
    unifiedModelId: ctx.unifiedModelId,
    channelId: null,
    channelName: null,
    status: 'success',
    stream: false,
    cached: true,
    inputTokens: cached.inputTokens,
    outputTokens: cached.outputTokens,
    costMicros: 0,
    attemptCount: 0,
    fallback: false,
    latencyMs,
  });
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
  },
  status: Exclude<RequestLogStatus, 'success' | 'error' | 'cancelled'>,
  latencyMs: number,
): Promise<void> {
  await insertRequestLog(env.DB, {
    id: generateId(),
    timestamp: Math.floor(Date.now() / 1000),
    requestId: ctx.requestId,
    keyId: ctx.keyId,
    keyName: ctx.keyName,
    modelCardId: ctx.modelCardId,
    unifiedModelId: ctx.model,
    channelId: null,
    channelName: null,
    status,
    stream: false,
    cached: false,
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0,
    attemptCount: 0,
    fallback: false,
    latencyMs,
  });
}
