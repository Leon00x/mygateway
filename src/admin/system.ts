/**
 * System settings and provider presets API.
 */

import { Env } from '../env.ts';
import { PROVIDER_PRESETS } from '../shared/provider-presets.ts';
import { json } from './router.ts';

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
