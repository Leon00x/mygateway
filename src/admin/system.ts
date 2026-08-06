/**
 * System settings and provider presets API.
 */

import { Env } from '../env.ts';
import { PROVIDER_PRESETS } from '../shared/provider-presets.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { json } from './router.ts';
import { getSetting, setSetting } from '../db/settings.ts';
import { invalidateLogPolicyCache } from '../gateway/log-policy.ts';

/**
 * GET /admin/api/system/presets
 */
export function handleProviderPresets(requestId: string): Response {
  return json({ presets: PROVIDER_PRESETS });
}

/**
 * GET/PUT /admin/api/system/settings
 */
export async function handleSystemSettings(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const result = await env.DB
      .prepare('SELECT key, value, updated_at FROM system_settings')
      .all();
    const settings: Record<string, { value: string; updated_at: number }> = {};
    for (const row of result.results as { key: string; value: string; updated_at: number }[]) {
      settings[row.key] = { value: row.value, updated_at: row.updated_at };
    }
    return json({ settings });
  }

  if (request.method === 'PUT') {
    try {
      const body = (await request.json()) as Record<string, string>;
      const now = Math.floor(Date.now() / 1000);
      for (const [key, value] of Object.entries(body)) {
        await env.DB
          .prepare(
            'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?',
          )
          .bind(key, value, now, value, now)
          .run();
      }
      return json({ ok: true });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}

/**
 * GET/PUT /admin/api/settings/logging — request-log level switches.
 */
export async function handleLoggingSettings(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const [logSuccess, logErrors] = await Promise.all([
      getSetting(env.DB, 'log_success'),
      getSetting(env.DB, 'log_errors'),
    ]);
    return json({ log_success: logSuccess !== 'false', log_errors: logErrors !== 'false' });
  }

  if (request.method === 'PUT') {
    try {
      const body = (await request.json()) as { log_success?: unknown; log_errors?: unknown };
      if (body.log_success !== undefined && typeof body.log_success !== 'boolean') {
        return gatewayErrorResponse('invalid_request', 'log_success must be a boolean', requestId);
      }
      if (body.log_errors !== undefined && typeof body.log_errors !== 'boolean') {
        return gatewayErrorResponse('invalid_request', 'log_errors must be a boolean', requestId);
      }
      if (body.log_success !== undefined) {
        await setSetting(env.DB, 'log_success', String(body.log_success));
      }
      if (body.log_errors !== undefined) {
        await setSetting(env.DB, 'log_errors', String(body.log_errors));
      }
      invalidateLogPolicyCache();
      return json({ ok: true });
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}
