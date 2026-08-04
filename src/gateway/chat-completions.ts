/**
 * Chat Completions handler — the core gateway proxy with fallback.
 */

import { Env, parseConfig } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { buildUpstreamHeaders, gatewayResponseHeaders } from '../http/headers.ts';
import { readLimitedBody, BodyTooLargeError } from '../http/body-limit.ts';
import { applyServerTiming } from '../http/server-timing.ts';
import { classifyUpstreamError } from './fallback-policy.ts';
import { decryptProviderKey } from '../crypto/provider-key.ts';
import { SseDecoder, extractNonStreamUsage, Usage } from '../streaming/sse-decoder.ts';
import { upsertUsageMinute } from '../db/usage.ts';
import { nowMinute } from '../shared/ids.ts';
import { logEvent } from '../shared/log.ts';
import {
  authenticateGatewayKeyHash,
  resolveGatewayAccess,
  type GatewayAccessMetrics,
} from './access-resolver.ts';

interface RequestPerformance {
  requestStartedAt: number;
  access: GatewayAccessMetrics;
  upstreamTtfbMs: number;
  gatewayTtfbMs: number;
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

/**
 * POST /v1/chat/completions
 */
export async function handleChatCompletions(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  requestId: string,
  gatewayKeyHash: string,
): Promise<Response> {
  const requestStartedAt = performance.now();
  const config = parseConfig(env);

  const invalidKeyResponse = () => gatewayErrorResponse(
    'invalid_api_key',
    'Invalid API key',
    requestId,
  );

  // 1. Read and validate body
  let bodyText: string | null;
  try {
    bodyText = await readLimitedBody(request, config.maxRequestBytes, requestId);
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      const response = !(await authenticateGatewayKeyHash(env.DB, gatewayKeyHash))
        ? invalidKeyResponse()
        : gatewayErrorResponse('request_too_large', 'Request body exceeds size limit', requestId);
      return applyServerTiming(response, { gatewayTtfbMs: elapsedMs(requestStartedAt) });
    }
    throw e;
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(bodyText ?? '');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Authenticate first so malformed bodies cannot reveal validation behavior
    // to callers with an invalid but syntactically well-formed Gateway Key.
  }

  const model = body?.model;
  const modelCanResolve = typeof model === 'string' && model.length > 0 && model.length <= 128;
  const access = modelCanResolve
    ? await resolveGatewayAccess(env.DB, gatewayKeyHash, model)
    : { key: await authenticateGatewayKeyHash(env.DB, gatewayKeyHash), model: null, metrics: undefined };

  if (access.metrics) {
    logEvent({
      event: 'gateway_access_resolved',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      key_valid: access.key !== null,
      model_status: access.model?.status ?? 'not_resolved',
      cache_status: access.metrics.cacheStatus,
      key_cache: access.metrics.keyCache,
      model_cache: access.metrics.modelCache,
      d1_statements: access.metrics.d1Statements,
      d1_ms: access.metrics.d1Ms,
      access_ms: access.metrics.accessMs,
    });
  }

  const timed = (response: Response, upstreamTtfbMs?: number) => applyServerTiming(response, {
    access: access.metrics,
    upstreamTtfbMs,
    gatewayTtfbMs: elapsedMs(requestStartedAt),
  });

  if (!access.key) return timed(invalidKeyResponse());
  if (!body) {
    return timed(gatewayErrorResponse('invalid_request', 'Invalid JSON body', requestId));
  }
  if (!modelCanResolve) {
    return timed(gatewayErrorResponse('invalid_request', 'model must be a non-empty string (max 128 chars)', requestId, 'model'));
  }

  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return timed(gatewayErrorResponse('invalid_request', 'messages must be an array', requestId, 'messages'));
  }

  const isStream = body.stream === true;

  // 2. Authentication and model routing were resolved together above.
  if (!access.model || access.model.status === 'not_found') {
    return timed(gatewayErrorResponse('model_not_found', `Model '${model}' not found`, requestId, 'model'));
  }
  if (access.model.status === 'unavailable') {
    return timed(gatewayErrorResponse(
      'model_unavailable',
      `No active channel available for model '${model}'`,
      requestId,
      'model',
    ));
  }

  const { direct, candidates, unifiedModelId, modelCardId } = access.model.value;
  const maxAttempts = Math.min(candidates.length, config.maxChannelAttempts);

  // 3. Try candidates with fallback
  let lastError: { status: number; body: string } | null = null;
  let lastRetryableError: { status: number; body: string } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = candidates[attempt];
    const isLastAttempt = attempt === maxAttempts - 1;

    logEvent({
      event: 'upstream_attempt_started',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      model_id: model,
      channel_id: candidate.channel_id,
      channel_name: candidate.channel_name,
      attempt: attempt + 1,
    });

    // Decrypt provider key
    let providerKey: string;
    try {
      providerKey = await decryptProviderKey(
        candidate.api_key_ciphertext,
        candidate.api_key_iv,
        env.MASTER_KEY,
        candidate.channel_id,
        candidate.api_key_version,
      );
    } catch {
      // Key decryption failure — treat as retryable
      logEvent({
        event: 'upstream_attempt_failed',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        channel_id: candidate.channel_id,
        attempt: attempt + 1,
        error_kind: 'key_decryption',
        will_fallback: !direct && !isLastAttempt,
      });
      if (direct || isLastAttempt) {
        return timed(gatewayErrorResponse('upstream_error', 'Failed to decrypt provider key', requestId));
      }
      lastRetryableError = { status: 500, body: 'Key decryption failed' };
      continue;
    }

    // Build upstream URL
    const upstreamUrl = `${candidate.base_url}/chat/completions`;

    // Build upstream body — replace model, inject stream_options
    const upstreamBody = structuredClone(body);
    upstreamBody.model = candidate.channel_model_id;
    if (isStream && candidate.supports_stream_usage === 1) {
      upstreamBody.stream_options = {
        ...(typeof upstreamBody.stream_options === 'object' && upstreamBody.stream_options ? upstreamBody.stream_options : {}),
        include_usage: true,
      };
    }

    // Build upstream headers
    const upstreamHeaders = buildUpstreamHeaders({
      providerApiKey: providerKey,
      requestId,
      isStream,
      appVersion: config.appVersion,
    });

    // Send upstream request with timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(),
      config.upstreamHeaderTimeoutMs,
    );

    let upstreamResponse: Response;
    const upstreamStartedAt = performance.now();
    let upstreamTtfbMs: number;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamBody),
        signal: abortController.signal,
      });
      upstreamTtfbMs = elapsedMs(upstreamStartedAt);
      clearTimeout(timeoutId);
    } catch (e) {
      clearTimeout(timeoutId);
      upstreamTtfbMs = elapsedMs(upstreamStartedAt);
      const isTimeout = (e as Error).name === 'AbortError';
      logEvent({
        event: 'upstream_attempt_failed',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        channel_id: candidate.channel_id,
        attempt: attempt + 1,
        error_kind: isTimeout ? 'timeout' : 'connection',
        upstream_ttfb_ms: upstreamTtfbMs,
        will_fallback: !direct && !isLastAttempt,
      });
      // Connection failure or timeout
      if (direct || isLastAttempt) {
        return timed(gatewayErrorResponse(
          isTimeout ? 'upstream_timeout' : 'upstream_error',
          isTimeout ? 'Upstream response timeout' : 'Upstream connection failed',
          requestId,
        ), upstreamTtfbMs);
      }
      lastRetryableError = { status: 0, body: (e as Error).message };
      continue;
    }

    // Check if response is retryable
    if (!upstreamResponse.ok) {
      const kind = classifyUpstreamError(upstreamResponse.status);

      // Read error body (with limit)
      let errorBody = '';
      try {
        errorBody = await upstreamResponse.text();
        if (errorBody.length > 4096) errorBody = errorBody.slice(0, 4096) + '...';
      } catch { /* ignore */ }

      lastError = { status: upstreamResponse.status, body: errorBody };
      const willFallback = kind === 'retryable' && !direct && !isLastAttempt;

      logEvent({
        event: 'upstream_attempt_failed',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        channel_id: candidate.channel_id,
        status: upstreamResponse.status,
        attempt: attempt + 1,
        upstream_ttfb_ms: upstreamTtfbMs,
        will_fallback: willFallback,
      });

      if (willFallback) {
        lastRetryableError = lastError;
        continue;
      }

      // Not retryable or last attempt — return the error
      const respHeaders = gatewayResponseHeaders(requestId);
      return timed(new Response(errorBody, {
        status: upstreamResponse.status,
        headers: respHeaders,
      }), upstreamTtfbMs);
    }

    // --- Success: upstream accepted the response ---
    logEvent({
      event: 'upstream_response_accepted',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      channel_id: candidate.channel_id,
      channel_name: candidate.channel_name,
      attempt: attempt + 1,
      upstream_ttfb_ms: upstreamTtfbMs,
      gateway_ttfb_ms: elapsedMs(requestStartedAt),
      cache_status: access.metrics?.cacheStatus,
      d1_ms: access.metrics?.d1Ms,
    });

    const fallbackOccurred = attempt > 0;
    const requestPerformance: RequestPerformance = {
      requestStartedAt,
      access: access.metrics!,
      upstreamTtfbMs,
      gatewayTtfbMs: elapsedMs(requestStartedAt),
    };

    // 4a. Non-streaming
    if (!isStream) {
      return applyServerTiming(await handleNonStreamResponse(
        upstreamResponse,
        requestId,
        env,
        ctx,
        config,
        modelCardId,
        unifiedModelId,
        candidate,
        attempt + 1,
        fallbackOccurred,
        requestPerformance,
      ), requestPerformance);
    }

    // 4b. Streaming
    return applyServerTiming(handleStreamResponse(
      upstreamResponse,
      requestId,
      abortController,
      env,
      ctx,
      config,
      modelCardId,
      unifiedModelId,
      candidate,
      attempt + 1,
      fallbackOccurred,
      requestPerformance,
    ), requestPerformance);
  }

  // All candidates exhausted
  if (lastRetryableError) {
    const isAllTimeout = lastRetryableError.status === 0;
    return timed(gatewayErrorResponse(
      isAllTimeout ? 'upstream_timeout' : 'upstream_error',
      isAllTimeout ? 'All upstream candidates timed out' : 'All upstream candidates failed',
      requestId,
    ));
  }

  return timed(gatewayErrorResponse('model_unavailable', `No active channel available for model '${model}'`, requestId, 'model'));
}

/**
 * Handle non-streaming response: tee body, parse usage async via ctx.waitUntil.
 */
async function handleNonStreamResponse(
  upstream: Response,
  requestId: string,
  env: Env,
  ctx: ExecutionContext,
  config: ReturnType<typeof parseConfig>,
  modelCardId: string,
  unifiedModelId: string,
  candidate: { channel_id: string; channel_name: string },
  attemptCount: number,
  fallbackOccurred: boolean,
  requestPerformance: RequestPerformance,
): Promise<Response> {
  // Clone the body so we can parse usage while forwarding
  const [bodyBranch, usageBranch] = upstream.body!.tee();

  const respHeaders = gatewayResponseHeaders(requestId);
  respHeaders.set('Content-Type', 'application/json');

  // Schedule usage parsing + write — guaranteed to complete via waitUntil
  const usagePromise = (async () => {
    let outcome: 'success' | 'usage_unknown' = 'success';
    let usage: Usage | null = null;
    try {
      const text = await new Response(usageBranch).text();
      const json = JSON.parse(text);
      usage = extractNonStreamUsage(json);
      if (!usage) outcome = 'usage_unknown';
    } catch {
      outcome = 'usage_unknown';
    }

    try {
      await writeUsage(env, modelCardId, unifiedModelId, candidate, attemptCount, fallbackOccurred, 'success', usage);
    } catch {
      logEvent({
        event: 'usage_write_failed',
        timestamp: new Date().toISOString(),
        request_id: requestId,
      });
    } finally {
      logEvent({
        event: 'gateway_request_completed',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        stream: false,
        outcome,
        total_ms: elapsedMs(requestPerformance.requestStartedAt),
        attempt_count: attemptCount,
        fallback_occurred: fallbackOccurred,
        cache_status: requestPerformance.access.cacheStatus,
        d1_ms: requestPerformance.access.d1Ms,
        upstream_ttfb_ms: requestPerformance.upstreamTtfbMs,
      });
    }
  })();

  ctx.waitUntil(usagePromise);

  return new Response(bodyBranch, {
    status: upstream.status,
    headers: respHeaders,
  });
}

/**
 * Handle streaming response: create proxy ReadableStream with SSE usage observation.
 */
function handleStreamResponse(
  upstream: Response,
  requestId: string,
  abortController: AbortController,
  env: Env,
  ctx: ExecutionContext,
  config: ReturnType<typeof parseConfig>,
  modelCardId: string,
  unifiedModelId: string,
  candidate: { channel_id: string; channel_name: string; supports_stream_usage: 0 | 1 },
  attemptCount: number,
  fallbackOccurred: boolean,
  requestPerformance: RequestPerformance,
): Response {
  const decoder = new SseDecoder();
  const reader = upstream.body!.getReader();

  let finalized = false;

  const finalize = async (outcome: 'success' | 'error' | 'cancelled') => {
    if (finalized) return;
    finalized = true;
    decoder.flush();
    const usage = decoder.parseError ? null : decoder.usage;
    try {
      await writeUsage(env, modelCardId, unifiedModelId, candidate, attemptCount, fallbackOccurred, outcome, usage);
    } catch {
      logEvent({
        event: 'usage_write_failed',
        timestamp: new Date().toISOString(),
        request_id: requestId,
      });
    } finally {
      logEvent({
        event: 'gateway_request_completed',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        stream: true,
        outcome,
        total_ms: elapsedMs(requestPerformance.requestStartedAt),
        attempt_count: attemptCount,
        fallback_occurred: fallbackOccurred,
        cache_status: requestPerformance.access.cacheStatus,
        d1_ms: requestPerformance.access.d1Ms,
        upstream_ttfb_ms: requestPerformance.upstreamTtfbMs,
      });
    }
  };

  const clientStream = new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          await finalize('success');
          controller.close();
          return;
        }
        decoder.observe(result.value);
        controller.enqueue(result.value);
      } catch (e) {
        await finalize('error');
        controller.error(e);
      }
    },

    async cancel(reason) {
      abortController.abort(reason);
      try {
        await reader.cancel(reason);
      } catch { /* ignore */ }
      await finalize('cancelled');
    },
  });

  const respHeaders = gatewayResponseHeaders(requestId);
  respHeaders.set('Content-Type', 'text/event-stream');
  respHeaders.set('Cache-Control', 'no-cache');
  respHeaders.set('Connection', 'keep-alive');

  return new Response(clientStream, {
    status: upstream.status,
    headers: respHeaders,
  });
}

/**
 * Write usage to D1.
 */
async function writeUsage(
  env: Env,
  modelCardId: string,
  unifiedModelId: string,
  candidate: { channel_id: string; channel_name: string },
  attemptCount: number,
  fallbackOccurred: boolean,
  outcome: 'success' | 'error' | 'cancelled',
  usage: Usage | null,
): Promise<void> {
  const minute = nowMinute();

  await upsertUsageMinute(env.DB, {
    timestamp_minute: minute,
    model_card_id: modelCardId,
    channel_id: candidate.channel_id,
    unified_model_id_snapshot: unifiedModelId,
    channel_name_snapshot: candidate.channel_name,
    request_count: 1,
    success_count: outcome === 'success' ? 1 : 0,
    error_count: outcome === 'error' ? 1 : 0,
    cancelled_count: outcome === 'cancelled' ? 1 : 0,
    fallback_count: fallbackOccurred ? 1 : 0,
    attempt_count_total: attemptCount,
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    usage_unknown_count: usage === null ? 1 : 0,
  });
}
