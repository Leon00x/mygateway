/**
 * Admin API router — /admin/api/*
 */

import { Env } from '../env.ts';
import { generateRequestId } from '../http/request-id.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { validateAdminSession, createAdminSession, clearSessionCookie } from '../auth/admin-session.ts';
import { verifyAdminToken } from '../auth/admin-token.ts';
import { logAuthFailed } from '../shared/log.ts';
import { handleChannelsCollection, handleChannelItem, handleChannelTest } from './channels.ts';
import { handleModelsCollection, handleModelItem, handleModelInstances, handleReorderInstances } from './models.ts';
import { handleKeysCollection, handleKeyItem, handleKeyRegenerate } from './keys.ts';
import { handleUsageOverview, handleUsageByModel, handleUsageByChannel, handleUsageClear } from './usage.ts';

/** JSON response helper. */
export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  const h = new Headers({ 'Content-Type': 'application/json', ...headers });
  return new Response(JSON.stringify(data), { status, headers: h });
}

/**
 * Handle /admin/api/* requests.
 */
export async function handleAdminApi(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const requestId = generateRequestId();
  const path = url.pathname;

  // --- Auth routes (no session required) ---
  if (path === '/admin/api/auth/login' && request.method === 'POST') {
    return handleLogin(request, env, requestId);
  }

  // --- Session required for everything else ---
  const isAuthenticated = await validateAdminSession(request, env.ADMIN_TOKEN);
  if (!isAuthenticated) {
    logAuthFailed(requestId, 'invalid_or_missing_session');
    return gatewayErrorResponse('invalid_api_key', 'Admin session required', requestId);
  }

  // Check same-origin for mutation requests (CSRF protection)
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (origin && host && !origin.includes(host)) {
      return gatewayErrorResponse('invalid_request', 'Cross-origin request denied', requestId);
    }
  }

  // --- Auth session/logout ---
  if (path === '/admin/api/auth/session' && request.method === 'GET') {
    return json({ authenticated: true });
  }

  if (path === '/admin/api/auth/logout' && request.method === 'POST') {
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': clearSessionCookie() },
    });
  }

  // --- Channels ---
  if (path === '/admin/api/channels') {
    return handleChannelsCollection(request, env, requestId);
  }
  if (path.match(/^\/admin\/api\/channels\/[^/]+\/test$/)) {
    const parts = path.split('/');
    const id = parts[parts.length - 2];
    return handleChannelTest(request, id, env, requestId);
  }
  if (path.match(/^\/admin\/api\/channels\/[^/]+$/)) {
    const id = path.split('/').pop()!;
    return handleChannelItem(request, id, env, requestId);
  }

  // --- Models ---
  if (path === '/admin/api/models') {
    return handleModelsCollection(request, env, requestId);
  }
  if (path.match(/^\/admin\/api\/models\/[^/]+\/instances\/reorder$/)) {
    const parts = path.split('/');
    const modelId = parts[parts.length - 3];
    return handleReorderInstances(request, modelId, env, requestId);
  }
  if (path.match(/^\/admin\/api\/models\/[^/]+\/instances$/)) {
    const parts = path.split('/');
    const modelId = parts[parts.length - 2];
    return handleModelInstances(request, modelId, env, requestId);
  }
  if (path.match(/^\/admin\/api\/models\/[^/]+$/)) {
    const id = path.split('/').pop()!;
    return handleModelItem(request, id, env, requestId);
  }

  // --- Gateway Keys ---
  if (path === '/admin/api/keys') {
    return handleKeysCollection(request, env, requestId);
  }
  if (path.match(/^\/admin\/api\/keys\/[^/]+\/regenerate$/)) {
    const parts = path.split('/');
    const id = parts[parts.length - 2];
    return handleKeyRegenerate(request, id, env, requestId);
  }
  if (path.match(/^\/admin\/api\/keys\/[^/]+$/)) {
    const id = path.split('/').pop()!;
    return handleKeyItem(request, id, env, requestId);
  }

  // --- Usage ---
  if (path === '/admin/api/usage/overview') {
    return handleUsageOverview(url, env, requestId);
  }
  if (path === '/admin/api/usage/by-model') {
    return handleUsageByModel(url, env, requestId);
  }
  if (path === '/admin/api/usage/by-channel') {
    return handleUsageByChannel(url, env, requestId);
  }
  if (path === '/admin/api/usage' && request.method === 'DELETE') {
    return handleUsageClear(env, requestId);
  }

  // --- System ---
  if (path === '/admin/api/system/status') {
    return json({
      version: env.APP_VERSION ?? '0.1.0',
      status: 'ok',
    });
  }

  if (path === '/admin/api/system/settings') {
    const { handleSystemSettings } = await import('./system.ts');
    return handleSystemSettings(request, env, requestId);
  }

  if (path === '/admin/api/system/presets') {
    const { handleProviderPresets } = await import('./system.ts');
    return handleProviderPresets(requestId);
  }

  return gatewayErrorResponse('invalid_request', 'Admin API route not found', requestId);
}

/**
 * POST /admin/api/auth/login
 */
async function handleLogin(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  try {
    const body = (await request.json()) as { token?: string };
    if (!body.token) {
      return gatewayErrorResponse('invalid_request', 'Token is required', requestId);
    }

    const valid = await verifyAdminToken(body.token, env.ADMIN_TOKEN);
    if (!valid) {
      logAuthFailed(requestId, 'invalid_admin_token');
      return gatewayErrorResponse('invalid_api_key', 'Invalid admin token', requestId);
    }

    const setCookie = await createAdminSession(env.ADMIN_TOKEN);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': setCookie,
        'x-gateway-request-id': requestId,
      },
    });
  } catch {
    return gatewayErrorResponse('invalid_request', 'Invalid request body', requestId);
  }
}
