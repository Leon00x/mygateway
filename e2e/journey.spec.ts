/**
 * E2E: full user journey through the MyGateway admin dashboard.
 * Requires a local wrangler dev server on :8799 with a clean D1.
 *
 * Flow (serial, one file):
 *   1. auth: guard → login page → wrong credentials → correct credentials → dashboard
 *   2. channels: preset add DeepSeek → list shows it
 *   3. models: create card → add instance bound to channel
 *   4. api keys: create key → plaintext shown once → list shows it
 *   5. gateway: /v1/models + /v1/chat/completions via real HTTP (Bearer key)
 *   6. dashboard: endpoint card shows channel + model
 *   7. logout → back to login
 */

import { test, expect } from '@playwright/test';
import { loginViaUi, loginViaApi, resetState, uniq } from './helpers';

test.describe.configure({ mode: 'serial' });

let gwKey = '';
const channelName = 'DeepSeek'; // preset name, fixed by the modal
const channelAlias = uniq('ds-');
const modelId = 'e2e-' + Date.now().toString(36);

test.beforeAll(async ({ request }) => {
  await resetState(request);
});

test('1. auth guard redirects to login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByPlaceholder('用户名')).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/login/);
});

test('2. wrong administrator credentials show error', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('用户名').fill('admin');
  await page.getByPlaceholder('密码').fill('wrong-password');
  await page.getByRole('button', { name: '登录控制台' }).click();
  await expect(page.locator('.form-error')).toBeVisible({ timeout: 10_000 });
});

test('3. correct credentials log in → dashboard shows endpoint', async ({ page }) => {
  await loginViaUi(page);
  await expect(page.getByText('Gateway Endpoint')).toBeVisible();
  await expect(page.locator('code').first()).toContainText('/v1');
});

test('4. add channel via preset modal', async ({ page }) => {
  await loginViaUi(page);
  await page.locator('.sidebar').getByRole('link', { name: /渠道/ }).click();
  await expect(page).toHaveURL(/\/channels/);

  await page.getByRole('button', { name: '+ 添加供应商' }).click();
  await page.getByRole('button', { name: /DeepSeek/ }).first().click();
  await page.getByPlaceholder('sk-...').fill('sk-e2e-dummy-123456');
  await page.getByRole('button', { name: '确认添加' }).click();

  // List should show the channel (created from the DeepSeek preset)
  await expect(page.getByText(channelName).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: '查询余额' })).toBeVisible();
});

test('5. create model card + add instance via UI', async ({ page, request }) => {
  await loginViaUi(page);
  await loginViaApi(request);

  // Navigate to Models page
  await page.locator('.sidebar').getByRole('link', { name: /模型/ }).click();
  await expect(page).toHaveURL(/\/models/);

  // Create model card through the UI form
  await page.getByRole('button', { name: '+ 创建模型' }).click();
  await page.getByPlaceholder('统一模型 ID (如 deepseek-chat)').fill(modelId);
  await page.getByPlaceholder('显示名称 (如 DeepSeek Chat)').fill('E2E Model');
  await page.getByRole('button', { name: '创建', exact: true }).click();

  // Card appears in list
  await expect(page.getByText(modelId, { exact: true })).toBeVisible({ timeout: 10_000 });

  // Get channel id via API (needed to fill the instance form select)
  const channels = await request.get('/admin/api/channels').then((r) => r.json());
  const ch = channels.find((c: any) => c.name === channelName);
  expect(ch, `channel '${channelName}' from test 4 should exist`).toBeTruthy();

  // Expand the card and add an instance through the UI
  const cardRow = page.locator('div', { hasText: modelId }).first();
  await cardRow.getByRole('button', { name: '实例' }).click();
  await page.getByRole('button', { name: '+ 添加实例' }).click();

  // Select the channel in the dropdown
  await page.locator('form select').selectOption(ch.id);
  await page.getByPlaceholder('上游模型 ID (如 deepseek-chat)').fill('deepseek-chat');
  await page.getByPlaceholder('公开别名 (如 ds-deepseek-chat)').fill(channelAlias);
  await page.getByRole('button', { name: '添加实例', exact: true }).click();

  // Instance row appears with alias + channel
  await expect(page.getByText(channelAlias, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(new RegExp(channelName))).toBeVisible();

  // Verify via API: card has 1 instance
  const models = await request.get('/admin/api/models').then((r) => r.json());
  const created = models.find((m: any) => m.unified_model_id === modelId);
  expect(created).toBeTruthy();
  expect(created.instances.length).toBe(1);
  expect(created.instances[0].public_model_alias).toBe(channelAlias);
});

test('6. create gateway key → plaintext shown once', async ({ page }) => {
  await loginViaUi(page);
  await page.locator('.sidebar').getByRole('link', { name: /API 密钥/ }).click();
  await expect(page).toHaveURL(/\/keys/);

  await page.getByPlaceholder('Key name').fill(uniq('e2e-key'));
  await page.getByRole('button', { name: 'Create Key' }).click();

  const reveal = page.locator('.secret-reveal');
  await expect(reveal).toBeVisible({ timeout: 10_000 });
  const text = (await reveal.locator('code').textContent()) ?? '';
  expect(text).toMatch(/^gw_[A-Za-z0-9_-]{20,}/);
  gwKey = text.trim();

  await expect(page.getByText(/gw_/).first()).toBeVisible();
});

test('7. gateway call via real HTTP with Bearer key', async ({ request }) => {
  expect(gwKey, 'key must be created in test 6').toBeTruthy();

  const modelsResp = await request.get('/v1/models', {
    headers: { Authorization: `Bearer ${gwKey}` },
  });
  expect(modelsResp.status()).toBe(200);
  const models = await modelsResp.json();
  const ids = models.data.map((m: any) => m.id);
  expect(ids).toContain(modelId);
  expect(ids).toContain(channelAlias);

  // Dummy key → upstream DeepSeek rejects with 401 → gateway must pass through
  const chatResp = await request.post('/v1/chat/completions', {
    headers: {
      Authorization: `Bearer ${gwKey}`,
      'Content-Type': 'application/json',
    },
    data: {
      model: modelId,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    },
  });
  expect(chatResp.status()).toBe(401);
  const serverTiming = chatResp.headers()['server-timing'];
  const gatewayTiming = chatResp.headers()['x-gateway-timing'];
  expect(serverTiming).toContain('gateway-cache');
  expect(serverTiming).toContain('gateway-d1');
  expect(serverTiming).toContain('upstream-ttfb');
  expect(serverTiming).toContain('gateway-ttfb');
  expect(gatewayTiming).toBe(serverTiming);
  const body = await chatResp.json();
  expect(body.error).toBeTruthy();
  expect(body.error.message).toContain('api key');
});

test('8. no auth → 401 from gateway', async ({ request }) => {
  const resp = await request.post('/v1/chat/completions', {
    headers: { 'Content-Type': 'application/json' },
    data: { model: modelId, messages: [{ role: 'user', content: 'hi' }] },
  });
  expect(resp.status()).toBe(401);
  const body = await resp.json();
  expect(body.error.code).toBe('invalid_api_key');
});

test('9. dashboard shows channel and model', async ({ page }) => {
  await loginViaUi(page);
  await expect(page.getByText('Gateway Endpoint')).toBeVisible();
  await expect(page.getByText(channelName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(modelId, { exact: true })).toBeVisible();
  await expect(page.getByText('Provider Balance')).toBeVisible();
  await expect(page.getByText('点击刷新后查询')).toBeVisible();
});

test('10. logout returns to login', async ({ page }) => {
  await loginViaUi(page);
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByPlaceholder('用户名')).toBeVisible({ timeout: 10_000 });
});

test.afterAll(async ({ request }) => {
  await resetState(request);
});
