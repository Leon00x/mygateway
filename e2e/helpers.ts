/**
 * Shared helpers for E2E tests.
 * All tests run against a local wrangler dev server (http://localhost:8799).
 */

import { Page, expect, APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Initial credentials are read from env/.dev.vars — NEVER hardcode secrets.
export const ADMIN_USERNAME = process.env.INITIAL_ADMIN_USERNAME ?? devVar('INITIAL_ADMIN_USERNAME') ?? 'admin';
const INITIAL_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
  ?? devVar('INITIAL_ADMIN_PASSWORD')
  ?? process.env.ADMIN_TOKEN
  ?? devVar('ADMIN_TOKEN')
  ?? '';
const E2E_ADMIN_PASSWORD = 'e2e-local-admin-2026';
let activePassword = E2E_ADMIN_PASSWORD;

if (!INITIAL_ADMIN_PASSWORD) {
  throw new Error(
    'INITIAL_ADMIN_PASSWORD (or legacy ADMIN_TOKEN) not found. Add it to .dev.vars before running E2E tests.',
  );
}

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
export async function loginViaUi(page: Page, password: string = activePassword): Promise<void> {
  await page.goto('/');
  // Auth guard redirects to /login when unauthenticated
  await expect(page.getByPlaceholder('用户名')).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('用户名').fill(ADMIN_USERNAME);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByRole('button', { name: '登录控制台' }).click();
  // After login we land on the dashboard
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
}

/**
 * Log in via the admin API directly, using the given API context
 * (either `request` fixture or `page.request`). Cookie persists on that context.
 */
export async function loginViaApi(api: APIRequestContext): Promise<void> {
  let resp = await api.post('/admin/api/auth/login', { data: { username: ADMIN_USERNAME, password: activePassword } });
  if (!resp.ok()) {
    activePassword = INITIAL_ADMIN_PASSWORD;
    resp = await api.post('/admin/api/auth/login', { data: { username: ADMIN_USERNAME, password: activePassword } });
  }
  expect(resp.ok()).toBeTruthy();
  const login = await resp.json();
  if (login.must_change_password) {
    const changed = await api.post('/admin/api/auth/change-credentials', {
      data: { username: ADMIN_USERNAME, current_password: activePassword, new_password: E2E_ADMIN_PASSWORD },
    });
    expect(changed.ok()).toBeTruthy();
    activePassword = E2E_ADMIN_PASSWORD;
  }
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
