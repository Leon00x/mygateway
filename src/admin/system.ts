/**
 * System settings and provider presets API.
 */

import { Env } from '../env.ts';
import { PROVIDER_PRESETS } from '../shared/provider-presets.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { json } from './router.ts';
import { getSetting, setSetting } from '../db/settings.ts';
import { invalidateLogPolicyCache } from '../gateway/log-policy.ts';

const PUBLIC_URL_SETTING = 'public_url';

export function normalizePublicUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) {
    throw new Error('public_url must be a valid HTTP(S) origin');
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('public_url must be a valid HTTP(S) origin');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search || parsed.hash) {
    throw new Error('public_url must contain only an HTTP(S) origin without path, query, or credentials');
  }
  return parsed.origin;
}

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
      for (const [key, rawValue] of Object.entries(body)) {
        const value = key === PUBLIC_URL_SETTING ? normalizePublicUrl(rawValue) : rawValue;
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

/** GET/PUT /admin/api/system/public-url */
export async function handlePublicUrlSetting(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    return json({ public_url: await getSetting(env.DB, PUBLIC_URL_SETTING) });
  }
  if (request.method === 'PUT') {
    try {
      const body = await request.json() as { public_url?: unknown };
      const publicUrl = normalizePublicUrl(body.public_url);
      await setSetting(env.DB, PUBLIC_URL_SETTING, publicUrl);
      return json({ public_url: publicUrl });
    } catch (error) {
      return gatewayErrorResponse('invalid_request', (error as Error).message, requestId);
    }
  }
  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
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
