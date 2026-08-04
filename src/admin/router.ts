/**
 * Admin API router — /admin/api/*
 */

import { Env } from '../env.ts';
import { generateRequestId } from '../http/request-id.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { validateAdminSession, createAdminSession, clearSessionCookie } from '../auth/admin-session.ts';
import {
  hashPassword,
  validatePassword,
  validateUsername,
  verifyBootstrapPassword,
  verifyPassword,
} from '../auth/password.ts';
import {
  createInitialAdmin,
  getAdminById,
  getAdminByUsername,
  hasAdminUser,
  recordAdminLogin,
  updateAdminCredentials,
} from '../db/admin-users.ts';
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
  const session = await validateAdminSession(request, env.DB, env.MASTER_KEY);
  if (!session) {
    logAuthFailed(requestId, 'invalid_or_missing_session');
    return gatewayErrorResponse('invalid_api_key', 'Admin session required', requestId);
  }

  // Check same-origin for mutation requests (CSRF protection)
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    try {
      if (origin && host && new URL(origin).host !== host) {
        return gatewayErrorResponse('invalid_request', 'Cross-origin request denied', requestId);
      }
    } catch {
      return gatewayErrorResponse('invalid_request', 'Invalid request origin', requestId);
    }
  }

  // --- Auth session/logout ---
  if (path === '/admin/api/auth/session' && request.method === 'GET') {
    return json({
      authenticated: true,
      username: session.username,
      must_change_password: session.mustChangePassword,
    });
  }

  if (path === '/admin/api/auth/logout' && request.method === 'POST') {
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': clearSessionCookie(url.protocol === 'https:') },
    });
  }

  if (path === '/admin/api/auth/change-credentials' && request.method === 'POST') {
    return handleChangeCredentials(request, env, session.userId, requestId);
  }

  if (session.mustChangePassword) {
    return json({
      error: {
        message: 'Change the initial administrator credentials before continuing',
        type: 'admin_error',
        code: 'password_change_required',
      },
    }, 403);
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
    const body = (await request.json()) as { username?: string; password?: string };
    const username = body.username?.trim() ?? '';
    const password = body.password ?? '';
    if (!username || !password) {
      return gatewayErrorResponse('invalid_request', 'Username and password are required', requestId);
    }

    let user = await getAdminByUsername(env.DB, username);

    // First login creates the single D1 administrator from the one-time deploy secret.
    if (!user && !(await hasAdminUser(env.DB))) {
      const initialUsername = env.INITIAL_ADMIN_USERNAME ?? 'admin';
      const initialPassword = env.INITIAL_ADMIN_PASSWORD ?? env.ADMIN_TOKEN ?? '';
      const bootstrapValid = username === initialUsername && initialPassword.length > 0
        && await verifyBootstrapPassword(password, initialPassword);
      if (bootstrapValid) {
        user = await createInitialAdmin(env.DB, initialUsername, await hashPassword(password));
      }
    }

    const valid = user && await verifyPassword(password, {
      hash: user.password_hash,
      salt: user.password_salt,
      iterations: user.password_iterations,
    });
    if (!user || !valid) {
      logAuthFailed(requestId, 'invalid_admin_token');
      return gatewayErrorResponse('invalid_api_key', 'Invalid username or password', requestId);
    }

    await recordAdminLogin(env.DB, user.id);
    const setCookie = await createAdminSession(env.MASTER_KEY, user, new URL(request.url).protocol === 'https:');
    return new Response(JSON.stringify({
      ok: true,
      username: user.username,
      must_change_password: user.must_change_password === 1,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': setCookie,
        'x-gateway-request-id': requestId,
      },
    });
  } catch (error) {
    console.error('admin_login_failed', {
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return gatewayErrorResponse('invalid_request', 'Invalid request body', requestId);
  }
}

async function handleChangeCredentials(
  request: Request,
  env: Env,
  userId: string,
  requestId: string,
): Promise<Response> {
  try {
    const body = (await request.json()) as {
      current_password?: string;
      username?: string;
      new_password?: string;
    };
    const username = body.username?.trim() ?? '';
    const currentPassword = body.current_password ?? '';
    const newPassword = body.new_password ?? '';
    const usernameError = validateUsername(username);
    const passwordError = validatePassword(newPassword);
    if (usernameError || passwordError) {
      return gatewayErrorResponse('invalid_request', usernameError ?? passwordError!, requestId);
    }

    const user = await getAdminById(env.DB, userId);
    if (!user || !(await verifyPassword(currentPassword, {
      hash: user.password_hash,
      salt: user.password_salt,
      iterations: user.password_iterations,
    }))) {
      return gatewayErrorResponse('invalid_api_key', 'Current password is incorrect', requestId);
    }

    const existing = await getAdminByUsername(env.DB, username);
    if (existing && existing.id !== user.id) {
      return gatewayErrorResponse('invalid_request', 'Username is already in use', requestId);
    }

    const updated = await updateAdminCredentials(env.DB, user.id, username, await hashPassword(newPassword));
    const setCookie = await createAdminSession(
      env.MASTER_KEY,
      updated,
      new URL(request.url).protocol === 'https:',
    );
    return json({ ok: true, username: updated.username, must_change_password: false }, 200, {
      'Set-Cookie': setCookie,
      'x-gateway-request-id': requestId,
    });
  } catch (error) {
    return gatewayErrorResponse('invalid_request', (error as Error).message, requestId);
  }
}
