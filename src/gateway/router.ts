/**
 * Gateway /v1/* router.
 */

import { Env } from '../env.ts';
import { generateRequestId } from '../http/request-id.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { extractGatewayKey, hashGatewayKey } from '../auth/gateway-key.ts';
import { findActiveKeyByHash } from '../db/keys.ts';
import { logAuthFailed } from '../shared/log.ts';
import { handleChatCompletions } from './chat-completions.ts';
import { handleModelsList } from './models-list.ts';

/**
 * Handle /v1/* requests.
 */
export async function handleGateway(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const requestId = generateRequestId();
  const path = url.pathname;

  // --- Auth ---
  const rawKey = extractGatewayKey(request);
  if (!rawKey) {
    logAuthFailed(requestId, 'missing_gateway_key');
    return gatewayErrorResponse('invalid_api_key', 'Missing or invalid API key', requestId);
  }

  const keyHash = await hashGatewayKey(rawKey);
  const keyRecord = await findActiveKeyByHash(env.DB, keyHash);
  if (!keyRecord) {
    logAuthFailed(requestId, 'invalid_gateway_key');
    return gatewayErrorResponse('invalid_api_key', 'Invalid API key', requestId);
  }

  // --- Route ---
  if (path === '/v1/chat/completions' && request.method === 'POST') {
    return handleChatCompletions(request, env, ctx, requestId);
  }

  if (path === '/v1/models' && request.method === 'GET') {
    return handleModelsList(env, requestId);
  }

  return gatewayErrorResponse('invalid_request', 'Gateway route not found', requestId);
}
