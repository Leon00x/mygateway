/**
 * Shared helpers for E2E tests.
 * All tests run against a local wrangler dev server (http://localhost:8799).
 */

import { Page, expect, APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ADMIN_TOKEN = 'FDBmqO0xSiCNQ17ys6z2OPkkcB10FRkNuclmSU1Xwzo';

/**
 * Read a secret from .dev.vars (local dev only). Returns undefined if missing.
 * Never hardcode provider keys in test files — read them from env instead.
 */
export function devVar(name: string): string | undefined {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  try {
    const file = readFileSync(join(process.cwd(), '.dev.vars'), 'utf8');
    const line = file.split('\n').find((l: string) => l.trim().startsWith(`${name}=`));
    if (!line) return undefined;
    return line.trim().slice(name.length + 1);
  } catch {
    return undefined;
  }
}

/**
 * Log in through the UI. Assumes we're on /login or the app redirected us there.
 */
export async function loginViaUi(page: Page, token: string = ADMIN_TOKEN): Promise<void> {
  await page.goto('/');
  // Auth guard redirects to /login when unauthenticated
  await expect(page.getByPlaceholder('Admin Token')).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('Admin Token').fill(token);
  await page.getByRole('button', { name: 'Login' }).click();
  // After login we land on the dashboard
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
}

/**
 * Log in via the admin API directly, using the given API context
 * (either `request` fixture or `page.request`). Cookie persists on that context.
 */
export async function loginViaApi(api: APIRequestContext): Promise<void> {
  const resp = await api.post('/admin/api/auth/login', {
    data: { token: ADMIN_TOKEN },
  });
  expect(resp.ok()).toBeTruthy();
  const setCookie = resp.headers()['set-cookie'];
  const match = setCookie?.match(/mg_admin_session=[^;]+/);
  expect(match).not.toBeNull();
}

/**
 * Reset DB to a clean state: delete all channels (cascades instances+aliases),
 * all keys, and all model cards. Run at the start of the serial flow.
 */
export async function resetState(api: APIRequestContext): Promise<void> {
  await loginViaApi(api);

  const channels = await api.get('/admin/api/channels').then((r) => r.json());
  for (const ch of channels) {
    await api.delete(`/admin/api/channels/${ch.id}`);
  }

  const keys = await api.get('/admin/api/keys').then((r) => r.json());
  for (const k of keys) {
    await api.delete(`/admin/api/keys/${k.id}`);
  }

  const models = await api.get('/admin/api/models').then((r) => r.json());
  for (const m of models) {
    await api.delete(`/admin/api/models/${m.id}`);
  }
}

/**
 * Unique suffix for names so reruns don't collide on aliases/ids.
 */
export function uniq(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}
