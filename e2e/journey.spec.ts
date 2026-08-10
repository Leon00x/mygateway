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
import { ADMIN_USERNAME, loginViaUi, loginViaApi, resetState, uniq } from './helpers';

test.describe.configure({ mode: 'serial' });

let gwKey = '';
const channelName = 'DeepSeek'; // preset name, fixed by the modal
const channelAlias = uniq('ds-');
const modelId = 'e2e-' + Date.now().toString(36);
const catalogModelId = 'catalog-' + Date.now().toString(36);
const directModelId = 'direct-' + Date.now().toString(36);

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
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.form-error')).toBeVisible({ timeout: 10_000 });
});

test('3. correct credentials log in → dashboard shows endpoint', async ({ page }) => {
  await loginViaUi(page);
  await expect(page.getByText('API 基础地址')).toBeVisible();
  await expect(page.locator('code').first()).toContainText('/v1');

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible();
  await page.getByRole('button', { name: '展开侧边栏' }).click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/);

  await page.getByRole('button', { name: '切换到暗黑模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换到浅色模式' }).click();
});

test('4. add channel via preset modal', async ({ page }) => {
  await loginViaUi(page);
  await page.locator('.sidebar').getByRole('link', { name: /渠道/ }).click();
  await expect(page).toHaveURL(/\/channels/);

  await page.getByRole('button', { name: '+ 添加供应商' }).click();
  await page.getByRole('button', { name: /DeepSeek/ }).first().click();
  await page.getByPlaceholder('sk-...').fill('sk-e2e-dummy-123456');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '检测连接与模型' }).click();
  await expect(page.getByText('检测未通过')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /保存并导入.*0/ })).toBeDisabled();
  await page.getByRole('button', { name: '仍然保存' }).click();

  // A failed preflight still offers an explicit save-only fallback and the
  // catalog remains available for manual maintenance.
  await expect(page.locator('.channel-detail-modal').getByRole('heading', { name: 'DeepSeek' })).toBeVisible({ timeout: 15_000 });
  const completionStatus = page.getByRole('status');
  await expect(completionStatus.getByText('渠道添加完成')).toBeVisible();
  expect(await completionStatus.evaluate((element) => getComputedStyle(element).animationName)).toContain('creation-success-enter');
  await expect(page.locator('.channel-detail-modal').getByText('查询失败')).toBeVisible();

  // Manual fallback can still populate inventory and import a ready-to-call
  // unified model without visiting the Models page.
  await page.getByPlaceholder('手工增加上游模型 ID').fill('deepseek-catalog-e2e');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  const catalogRow = page.locator('.catalog-row', { hasText: 'deepseek-catalog-e2e' });
  await catalogRow.locator('input[type="checkbox"]').check();
  await catalogRow.getByLabel('统一模型 ID').fill(catalogModelId);
  await page.getByRole('button', { name: '导入为网关模型' }).click();
  await expect(catalogRow.getByText('已导入')).toBeVisible();

  const importedModels = await page.request.get('/admin/api/models').then((response) => response.json());
  const imported = importedModels.find((model: any) => model.unified_model_id === catalogModelId);
  expect(imported?.instances).toHaveLength(1);
  expect(imported.instances[0].channel_model_id).toBe('deepseek-catalog-e2e');
  const channelOverview = await page.request.get('/admin/api/channels/overview').then((response) => response.json());
  const createdChannel = channelOverview.channels.find((channel: any) => channel.name === channelName);
  expect(createdChannel.preset_id).toBe('deepseek');
  expect(createdChannel.protocols.map((protocol: any) => protocol.protocol)).toEqual([
    'anthropic_messages', 'openai_chat',
  ]);
  expect(channelOverview.summaries.find((summary: any) => summary.channel_id === createdChannel.id)?.available_count).toBe(1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  // List should show the channel (created from the DeepSeek preset)
  await expect(page.getByText(channelName).first()).toBeVisible({ timeout: 10_000 });
  const channelCard = page.locator('.channel-card', { hasText: channelName });
  await expect(channelCard.getByText('账户余额')).toBeVisible();
  await expect(channelCard.getByText('查询失败')).toBeVisible();
  await expect(channelCard.getByRole('button', { name: '编辑' })).toBeVisible();
  await channelCard.getByRole('button', { name: '编辑' }).click();
  await page.locator('.channel-detail-modal').getByRole('button', { name: '连接配置', exact: true }).click();
  const editModal = page.locator('.modal-card', { hasText: '连接配置' });
  await expect(editModal.getByText('Chat', { exact: true })).toBeVisible();
  await expect(editModal.getByText('Messages', { exact: true })).toBeVisible();
  await expect(editModal.getByText('https://api.deepseek.com/v1', { exact: true })).toBeVisible();
  await expect(editModal.getByText('https://api.deepseek.com/anthropic', { exact: true })).toBeVisible();
  await editModal.getByRole('button', { name: '×' }).click();
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
  const cardRow = page.locator('.model-card', { hasText: modelId });
  await cardRow.getByRole('button', { name: '+ 添加实例' }).click();

  // Select the channel in the dropdown
  await page.locator('form select').first().selectOption(ch.id);
  await page.getByPlaceholder('选择已发现模型或直接输入').fill('deepseek-chat');
  await page.getByPlaceholder('ds-deepseek-chat').fill(channelAlias);
  await page.locator('form.modal-card').getByRole('button', { name: '+ 添加实例', exact: true }).click();

  // Instance row appears with alias + channel
  await expect(page.getByText(channelAlias, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(cardRow.getByText(channelName, { exact: true }).first()).toBeVisible();

  // Verify via API: card has 1 instance
  const models = await request.get('/admin/api/models').then((r) => r.json());
  const created = models.find((m: any) => m.unified_model_id === modelId);
  expect(created).toBeTruthy();
  expect(created.instances.length).toBe(1);
  expect(created.instances[0].public_model_alias).toBe(channelAlias);

  // The create form can also bind a channel model in one operation.
  await page.getByRole('button', { name: '+ 创建模型' }).click();
  await page.getByPlaceholder('统一模型 ID (如 deepseek-chat)').fill(directModelId);
  await page.getByPlaceholder('显示名称 (如 DeepSeek Chat)').fill('Direct E2E Model');
  await page.locator('.model-bind-fields select').selectOption(ch.id);
  await page.getByPlaceholder('选择已发现模型或直接输入').fill('deepseek-direct-e2e');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByText(directModelId, { exact: true })).toBeVisible();

  const modelsAfterDirectCreate = await request.get('/admin/api/models').then((r) => r.json());
  const direct = modelsAfterDirectCreate.find((m: any) => m.unified_model_id === directModelId);
  expect(direct?.instances).toHaveLength(1);
  expect(direct.instances[0].channel_model_id).toBe('deepseek-direct-e2e');
});

test('6. create gateway key → plaintext shown once', async ({ page }) => {
  await loginViaUi(page);
  await page.locator('.sidebar').getByRole('link', { name: /密钥/ }).click();
  await expect(page).toHaveURL(/\/keys/);

  await page.getByPlaceholder('密钥名称').fill(uniq('e2e-key'));
  await page.getByRole('button', { name: /创建密钥/ }).click();

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
  await expect(page.getByText('API 基础地址')).toBeVisible();
  await expect(page.getByText(channelName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(modelId, { exact: true })).toBeVisible();
  await expect(page.getByText('供应商余额')).toBeVisible();
  await expect(page.getByText('点击刷新后查询')).toBeVisible();
});

test('10. delete channel reports impact and removes orphan models', async ({ page }) => {
  await loginViaUi(page);
  const backupResponse = await page.request.post('/admin/api/channels', {
    data: {
      name: 'Backup E2E',
      provider_type: 'openai_compatible',
      base_url: 'https://example.com/v1',
      api_key: 'sk-e2e-backup-dummy',
      protocols: [{ protocol: 'openai_chat', base_url: 'https://example.com/v1', auth_scheme: 'bearer' }],
    },
  });
  expect(backupResponse.ok()).toBeTruthy();
  const backupChannel = await backupResponse.json();
  const modelsBeforeDelete = await page.request.get('/admin/api/models').then((response) => response.json());
  const retainedModel = modelsBeforeDelete.find((model: any) => model.unified_model_id === modelId);
  const backupInstance = await page.request.post(`/admin/api/models/${retainedModel.id}/instances`, {
    data: {
      channel_id: backupChannel.id,
      channel_model_id: 'backup-deepseek-chat',
      public_model_alias: uniq('backup-alias'),
    },
  });
  expect(backupInstance.ok()).toBeTruthy();

  await page.locator('.sidebar').getByRole('link', { name: /渠道/ }).click();
  const channelCard = page.locator('.channel-card', { hasText: channelName });
  await channelCard.locator('summary').click();
  const dialogMessagePromise = new Promise<string>((resolve) => {
    page.once('dialog', async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    });
  });
  await channelCard.getByRole('button', { name: '删除渠道' }).click();
  const dialogMessage = await dialogMessagePromise;
  expect(dialogMessage).toContain('关联 3 个实例');
  expect(dialogMessage).toContain('2 个模型将失去最后渠道并一并删除');
  expect(dialogMessage).toContain('其他仍有渠道的模型只移除当前实例');
  await expect(channelCard).toHaveCount(0);

  const remainingModels = await page.request.get('/admin/api/models').then((response) => response.json());
  expect(remainingModels.map((model: any) => model.unified_model_id)).toContain(modelId);
  expect(remainingModels.map((model: any) => model.unified_model_id)).not.toEqual(
    expect.arrayContaining([catalogModelId, directModelId]),
  );
  expect(remainingModels.find((model: any) => model.unified_model_id === modelId)?.instances).toHaveLength(1);
});

test('11a. analytics usage page shows metric cards and filters', async ({ page }) => {
  await loginViaUi(page);
  const analyticsModule = page.locator('.sidebar').getByRole('button', { name: '分析' });
  await expect(analyticsModule).toBeVisible();
  await expect(analyticsModule.locator('svg')).toBeVisible();
  await expect(analyticsModule).toHaveAttribute('aria-expanded', 'true');
  await analyticsModule.click();
  await expect(page.locator('.sidebar').getByRole('link', { name: /用量分析/ })).toBeHidden();
  await analyticsModule.click();
  await page.locator('.sidebar').getByRole('link', { name: /用量分析/ }).click();
  await expect(page).toHaveURL(/\/analytics\/usage/);
  await expect(page.getByRole('heading', { level: 1, name: '用量分析' })).toBeVisible();
  await expect(page.locator('.analytics-metrics-grid')).toBeVisible({ timeout: 10_000 });
  // Range picker should expose quick and custom ranges.
  await page.getByRole('button', { name: '1 周' }).click();
  await expect(page.getByRole('button', { name: '今天' })).toBeVisible();
  await expect(page.getByRole('button', { name: '昨天' })).toBeVisible();
  await expect(page.getByRole('button', { name: '自定义' })).toBeVisible();
});

test('11b. analytics logs page shows settings and log table', async ({ page }) => {
  await loginViaUi(page);
  await page.locator('.sidebar').getByRole('link', { name: /请求日志/ }).click();
  await expect(page).toHaveURL(/\/analytics\/logs/);
  await expect(page.getByRole('heading', { level: 1, name: '请求日志' })).toBeVisible();
  // Settings area should toggle open
  await page.getByRole('button', { name: '日志设置' }).click();
  await expect(page.getByText('请求日志总开关')).toBeVisible();
  await expect(page.getByText('记录上下文')).toBeVisible();
  // Legacy /requests should redirect
  await page.goto('/requests');
  await expect(page).toHaveURL(/\/analytics\/logs/);
});

test('12. logout returns to login', async ({ page }) => {
  await loginViaUi(page);
  await page.getByRole('button', { name: /管理员菜单/ }).click();
  await expect(page.getByText(ADMIN_USERNAME, { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page.getByPlaceholder('用户名')).toBeVisible({ timeout: 10_000 });
});

test.afterAll(async ({ request }) => {
  await resetState(request);
});
