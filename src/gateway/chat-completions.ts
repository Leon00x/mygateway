/**
 * Chat Completions handler — the core gateway proxy with fallback.
 */

import { Env, parseConfig } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { buildUpstreamHeaders, gatewayResponseHeaders } from '../http/headers.ts';
import { readLimitedBody, BodyTooLargeError } from '../http/body-limit.ts';
import { resolveModel, ModelNotFoundError, ModelUnavailableError } from './model-resolver.ts';
import { classifyUpstreamError } from './fallback-policy.ts';
import { decryptProviderKey } from '../crypto/provider-key.ts';
import { SseDecoder, extractNonStreamUsage, Usage } from '../streaming/sse-decoder.ts';
import { upsertUsageMinute } from '../db/usage.ts';
import { nowMinute } from '../shared/ids.ts';
import { logEvent } from '../shared/log.ts';

/**
 * POST /v1/chat/completions
 */
export async function handleChatCompletions(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  requestId: string,
): Promise<Response> {
  const config = parseConfig(env);

  // 1. Read and validate body
  let bodyText: string | null;
  try {
    bodyText = await readLimitedBody(request, config.maxRequestBytes, requestId);
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return gatewayErrorResponse('request_too_large', 'Request body exceeds size limit', requestId);
    }
    throw e;
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyText!);
  } catch {
    return gatewayErrorResponse('invalid_request', 'Invalid JSON body', requestId);
  }

  const model = body.model;
  if (typeof model !== 'string' || !model || model.length > 128) {
    return gatewayErrorResponse('invalid_request', 'model must be a non-empty string (max 128 chars)', requestId, 'model');
  }

  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return gatewayErrorResponse('invalid_request', 'messages must be an array', requestId, 'messages');
  }

  const isStream = body.stream === true;

  // 2. Resolve model
  let resolved;
  try {
    resolved = await resolveModel(env.DB, model);
  } catch (e) {
    if (e instanceof ModelNotFoundError) {
      return gatewayErrorResponse('model_not_found', e.message, requestId, 'model');
    }
    if (e instanceof ModelUnavailableError) {
      return gatewayErrorResponse('model_unavailable', e.message, requestId, 'model');
    }
    throw e;
  }

  const { direct, candidates, unifiedModelId, modelCardId } = resolved;
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
      if (direct || isLastAttempt) {
        return gatewayErrorResponse('upstream_error', 'Failed to decrypt provider key', requestId);
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
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamBody),
        signal: abortController.signal,
      });
      clearTimeout(timeoutId);
    } catch (e) {
      clearTimeout(timeoutId);
      // Connection failure or timeout
      if (direct || isLastAttempt) {
        const isTimeout = (e as Error).name === 'AbortError';
        return gatewayErrorResponse(
          isTimeout ? 'upstream_timeout' : 'upstream_error',
          isTimeout ? 'Upstream response timeout' : 'Upstream connection failed',
          requestId,
        );
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

      if (kind === 'retryable' && !direct && !isLastAttempt) {
        lastRetryableError = lastError;
        logEvent({
          event: 'upstream_attempt_failed',
          timestamp: new Date().toISOString(),
          request_id: requestId,
          channel_id: candidate.channel_id,
          status: upstreamResponse.status,
          attempt: attempt + 1,
          will_fallback: true,
        });
        continue;
      }

      // Not retryable or last attempt — return the error
      const respHeaders = gatewayResponseHeaders(requestId);
      return new Response(errorBody, {
        status: upstreamResponse.status,
        headers: respHeaders,
      });
    }

    // --- Success: upstream accepted the response ---
    logEvent({
      event: 'upstream_response_accepted',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      channel_id: candidate.channel_id,
      channel_name: candidate.channel_name,
      attempt: attempt + 1,
    });

    const fallbackOccurred = attempt > 0;

    // 4a. Non-streaming
    if (!isStream) {
      return handleNonStreamResponse(
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
      );
    }

    // 4b. Streaming
    return handleStreamResponse(
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
    );
  }

  // All candidates exhausted
  if (lastRetryableError) {
    const isAllTimeout = lastRetryableError.status === 0;
    return gatewayErrorResponse(
      isAllTimeout ? 'upstream_timeout' : 'upstream_error',
      isAllTimeout ? 'All upstream candidates timed out' : 'All upstream candidates failed',
      requestId,
    );
  }

  return gatewayErrorResponse('model_unavailable', `No active channel available for model '${model}'`, requestId, 'model');
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
): Promise<Response> {
  // Clone the body so we can parse usage while forwarding
  const [bodyBranch, usageBranch] = upstream.body!.tee();

  const respHeaders = gatewayResponseHeaders(requestId);
  respHeaders.set('Content-Type', 'application/json');

  // Schedule usage parsing + write — guaranteed to complete via waitUntil
  const usagePromise = (async () => {
    try {
      const text = await new Response(usageBranch).text();
      const json = JSON.parse(text);
      const usage = extractNonStreamUsage(json);
      await writeUsage(env, modelCardId, unifiedModelId, candidate, attemptCount, fallbackOccurred, 'success', usage);
    } catch {
      await writeUsage(env, modelCardId, unifiedModelId, candidate, attemptCount, fallbackOccurred, 'success', null);
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
