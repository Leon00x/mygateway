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

  await page.getByRole('button', { name: '添加渠道' }).click();
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

  // Creating the same preset with the same provider key is rejected before it
  // can duplicate the channel or auto-import another model instance.
  const duplicateResponse = await page.request.post('/admin/api/channels', {
    data: {
      preset_id: 'deepseek',
      api_key: 'sk-e2e-dummy-123456',
      protocols: createdChannel.protocols,
    },
  });
  expect(duplicateResponse.status()).toBe(409);
  expect((await duplicateResponse.json()).error?.code).toBe('resource_in_use');
  const channelsAfterDuplicate = await page.request.get('/admin/api/channels').then((response) => response.json());
  expect(channelsAfterDuplicate.filter((channel: any) => channel.preset_id === 'deepseek')).toHaveLength(1);
  const modelsAfterDuplicate = await page.request.get('/admin/api/models').then((response) => response.json());
  expect(modelsAfterDuplicate.find((model: any) => model.unified_model_id === catalogModelId)?.instances).toHaveLength(1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  // List should show the channel (created from the DeepSeek preset)
  await expect(page.getByText(channelName).first()).toBeVisible({ timeout: 10_000 });
  const channelCard = page.locator('.channel-card', { hasText: channelName });
  await expect(channelCard.getByText('账户余额')).toBeVisible();
  await expect(channelCard.getByText('查询失败')).toBeVisible();
  await expect(channelCard.getByRole('button', { name: '管理' })).toBeVisible();
  await channelCard.getByRole('button', { name: '管理' }).click();
  await page.locator('.channel-detail-modal').getByRole('button', { name: '连接配置', exact: true }).click();
  const editModal = page.locator('.modal-card', { hasText: '连接配置' });
  await expect(editModal.getByText('Chat', { exact: true })).toBeVisible();
  await expect(editModal.getByText('Messages', { exact: true })).toBeVisible();
  await expect(editModal.locator('.protocol-url input').nth(0)).toHaveValue('https://api.deepseek.com/v1');
  await expect(editModal.locator('.protocol-url input').nth(2)).toHaveValue('https://api.deepseek.com/anthropic');
  await expect(editModal.getByText('/responses', { exact: true })).toBeVisible();
  await editModal.getByRole('button', { name: '×' }).click();
});

test('5. create model card + add instance via UI', async ({ page, request }) => {
  await loginViaUi(page);
  await loginViaApi(request);

  // Navigate to Models page
  await page.locator('.sidebar').getByRole('link', { name: /模型/ }).click();
  await expect(page).toHaveURL(/\/models/);

  // Create model card through the UI form
  await page.getByRole('button', { name: '创建模型' }).click();
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
  await cardRow.getByRole('button', { name: '+ 添加渠道' }).click();

  // Select the channel in the dropdown
  await page.locator('form select').first().selectOption(ch.id);
  await page.getByPlaceholder('选择已发现模型或直接输入').fill('deepseek-chat');
  await page.getByPlaceholder('ds-deepseek-chat').fill(channelAlias);
  await page.locator('form.modal-card').getByRole('button', { name: '+ 添加渠道', exact: true }).click();

  // Instance row appears with alias + channel
  await expect(page.getByText(channelAlias, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(cardRow.getByText(channelName, { exact: true }).first()).toBeVisible();

  // Verify via API: card has 1 instance
  const models = await request.get('/admin/api/models').then((r) => r.json());
  const created = models.find((m: any) => m.unified_model_id === modelId);
  expect(created).toBeTruthy();
  expect(created.instances.length).toBe(1);
  expect(created.instances[0].public_model_alias).toBe(channelAlias);

  const duplicateInstance = await request.post(`/admin/api/models/${created.id}/instances`, {
    data: {
      channel_id: ch.id,
      channel_model_id: 'another-upstream-id',
      public_model_alias: uniq('duplicate-'),
    },
  });
  expect(duplicateInstance.status()).toBe(409);
  expect((await duplicateInstance.json()).error?.code).toBe('resource_in_use');

  // The create form can also bind a channel model in one operation.
  await page.getByRole('button', { name: '创建模型' }).click();
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

test('6. create gateway key with expiration → plaintext shown once', async ({ page }) => {
  await loginViaUi(page);
  await page.locator('.sidebar').getByRole('link', { name: /密钥/ }).click();
  await expect(page).toHaveURL(/\/keys/);

  const keyName = uniq('e2e-key');
  const expiresAt = new Date(Date.now() + 86_400_000);
  const localExpiry = new Date(expiresAt.getTime() - expiresAt.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);
  await page.getByPlaceholder('密钥名称').fill(keyName);
  await page.getByLabel('到期时间').fill(localExpiry);
  await page.getByRole('button', { name: /创建密钥/ }).click();

  const reveal = page.locator('.secret-reveal');
  await expect(reveal).toBeVisible({ timeout: 10_000 });
  const text = (await reveal.locator('code').textContent()) ?? '';
  expect(text).toMatch(/^gw_[A-Za-z0-9_-]{20,}/);
  gwKey = text.trim();

  await expect(page.getByText(/gw_/).first()).toBeVisible();
  const keys = await page.request.get('/admin/api/keys').then((response) => response.json());
  const created = keys.find((key: any) => key.name === keyName);
  expect(created.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect(created.expires_at).toBeLessThanOrEqual(Math.floor(expiresAt.getTime() / 1000) + 60);

  const invalidExpiry = await page.request.post('/admin/api/keys', {
    data: { name: 'expired-e2e', expires_at: Math.floor(Date.now() / 1000) - 60 },
  });
  expect(invalidExpiry.status()).toBe(400);
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

  await page.getByRole('button', { name: '创建临时密钥并复制命令' }).click();
  await expect(page.getByText(/临时密钥仅保存在此浏览器/)).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mygateway.quickstartTempKey') ?? 'null'));
  expect(stored.key).toMatch(/^gw_[A-Za-z0-9_-]{20,}/);
  expect(stored.expiresAt).toBeGreaterThan(Date.now());
  await expect(page.locator('.quickstart-panel pre')).toContainText(stored.key);

  await page.reload();
  await expect(page.locator('.quickstart-panel pre')).toContainText(stored.key);
  await expect(page.getByRole('button', { name: '复制临时密钥命令' })).toBeVisible();

  await page.evaluate(() => {
    const storedKey = JSON.parse(localStorage.getItem('mygateway.quickstartTempKey') ?? 'null');
    localStorage.setItem('mygateway.quickstartTempKey', JSON.stringify({ ...storedKey, expiresAt: Date.now() - 1 }));
  });
  await page.reload();
  await expect(page.locator('.quickstart-panel pre')).toContainText('YOUR_GATEWAY_KEY');
  expect(await page.evaluate(() => localStorage.getItem('mygateway.quickstartTempKey'))).toBeNull();
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
  await channelCard.getByRole('button', { name: '删除渠道' }).click();
  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText('关联 3 个实例');
  await expect(confirmDialog).toContainText('2 个模型将失去最后渠道并一并删除');
  await expect(confirmDialog).toContainText('其他仍有渠道的模型只移除当前实例');
  await confirmDialog.getByRole('button', { name: '删除渠道' }).click();
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
  await expect(page.getByText('查看网关的用量与分析', { exact: true })).toBeVisible();
  const segmentTabs = page.locator('.analytics-segment-tabs');
  await expect(segmentTabs.getByRole('link', { name: '用量分析' })).toHaveClass(/active/);
  await expect(segmentTabs.getByRole('link', { name: '请求日志' })).toBeVisible();
  expect(await segmentTabs.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('17px');
  await expect(page.locator('.analytics-metrics-grid')).toBeVisible({ timeout: 10_000 });
  const ttftMetric = page.locator('.analytics-metric-card', { hasText: '平均首 Token 延迟' });
  await expect(ttftMetric.getByText('仅统计流式请求', { exact: true })).toBeVisible();
  await expect(page.locator('.analytics-axis-y').first()).toBeVisible();
  await expect(page.locator('.analytics-axis-x').first()).toBeVisible();
  const requestChart = page.locator('.analytics-trend-panel');
  const tokenChart = page.locator('.analytics-token-card');
  const [rangeBox, modelFilterBox, granularityBox] = await Promise.all([
    page.locator('.analytics-filters .tr-trigger').boundingBox(),
    page.getByLabel('模型').boundingBox(),
    page.getByLabel('趋势粒度').boundingBox(),
  ]);
  expect(rangeBox).not.toBeNull();
  expect(modelFilterBox).not.toBeNull();
  expect(granularityBox).not.toBeNull();
  expect(rangeBox!.height).toBeGreaterThanOrEqual(48);
  expect(Math.abs((rangeBox!.y + rangeBox!.height) - (modelFilterBox!.y + modelFilterBox!.height))).toBeLessThan(2);
  expect(rangeBox!.width).toBeGreaterThan(granularityBox!.width);
  const [requestBox, tokenBox] = await Promise.all([requestChart.boundingBox(), tokenChart.boundingBox()]);
  expect(requestBox).not.toBeNull();
  expect(tokenBox).not.toBeNull();
  expect(Math.abs(requestBox!.width - tokenBox!.width)).toBeLessThan(2);
  expect(Math.abs(requestBox!.y - tokenBox!.y)).toBeLessThan(2);
  await expect(tokenChart.getByText('输入（非缓存）', { exact: true }).first()).toBeVisible();
  await expect(tokenChart.getByText('缓存', { exact: true }).first()).toBeVisible();
  await expect(tokenChart.getByText('输出', { exact: true }).first()).toBeVisible();
  await requestChart.click();
  await expect(page.getByRole('dialog', { name: '请求趋势' })).toBeVisible();
  await page.getByRole('button', { name: '关闭图表' }).click();
  await expect(page.getByRole('dialog', { name: '请求趋势' })).toHaveCount(0);
  // Dense five-minute data is grouped to a stable visual density rather than
  // rendering thousands of hairline bars or stretched point markers.
  const denseEnd = Math.floor(Date.now() / 300) * 300;
  const denseStart = denseEnd - 7 * 86_400;
  const denseTrends = Array.from({ length: 2017 }, (_, index) => ({
    bucket: denseStart + index * 300,
    requests: index % 9 === 0 ? 2 : 1,
    input_tokens: 24 + index % 13,
    cache_input_tokens: index % 7,
    output_tokens: 8 + index % 5,
    cost_micros: 0,
  }));
  await page.route('**/admin/api/analytics/usage?*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      range: { start: denseStart, end: denseEnd },
      summary: { requests: 2241, successes: 2241, errors: 0, cancelled: 0, fallbacks: 0, input_tokens: 60_000, cache_input_tokens: 6_000, output_tokens: 20_000, usage_unknown: 0, cost_micros: 0, avg_latency_ms: 120, avg_ttft_ms: 42, ttft_count: 2241, latency_count: 2241 },
      models: [], trends: denseTrends,
    }),
  }));
  await page.getByLabel('趋势粒度').selectOption('');
  await expect(page.locator('.token-bar-input')).toHaveCount(47);
  expect(await page.locator('.token-bar-input').evaluateAll((bars) => bars.every((bar) => Number(bar.getAttribute('width')) >= 12))).toBe(true);
  await expect(page.locator('.analytics-trend-svg circle')).toHaveCount(0);
  await page.unroute('**/admin/api/analytics/usage?*');
  // Range picker should expose quick and custom ranges.
  await page.setViewportSize({ width: 520, height: 900 });
  await page.getByRole('button', { name: '1 周' }).click();
  await expect(page.getByRole('button', { name: '今天' })).toBeVisible();
  await expect(page.getByRole('button', { name: '昨天' })).toBeVisible();
  await expect(page.getByRole('button', { name: '自定义' })).toBeVisible();
  await page.getByRole('button', { name: '自定义' }).click();
  await expect(page.locator('.tr-calendar-picker')).toBeVisible();
  await expect(page.locator('.tr-calendar input[type="date"]')).toHaveCount(0);
  const [calendarBox, modelSelectBox] = await Promise.all([
    page.locator('.tr-popover').boundingBox(),
    page.locator('.analytics-filters label select').first().boundingBox(),
  ]);
  expect(calendarBox).not.toBeNull();
  expect(modelSelectBox).not.toBeNull();
  expect(calendarBox!.y + calendarBox!.height).toBeLessThanOrEqual(modelSelectBox!.y);
  const currentMonthDays = page.locator('.tr-days button:not(.outside)');
  await currentMonthDays.nth(4).click();
  await currentMonthDays.nth(8).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.locator('.tr-trigger-label')).toContainText('~');
  // A long custom range must stay inside the fixed time-filter column instead
  // of growing over the adjacent model selector on desktop.
  await page.setViewportSize({ width: 1440, height: 900 });
  const [rangeTriggerBox, desktopModelBox] = await Promise.all([
    page.locator('.tr-trigger').boundingBox(),
    page.locator('.analytics-filters label select').first().boundingBox(),
  ]);
  expect(rangeTriggerBox).not.toBeNull();
  expect(desktopModelBox).not.toBeNull();
  expect(rangeTriggerBox!.x + rangeTriggerBox!.width).toBeLessThanOrEqual(desktopModelBox!.x);
  expect(await page.locator('.tr-trigger-label').evaluate((label) => getComputedStyle(label).textOverflow)).toBe('ellipsis');
});

test('11b. analytics logs page shows log table, settings live in system page', async ({ page }) => {
  await loginViaUi(page);
  await page.locator('.sidebar').getByRole('link', { name: /请求日志/ }).click();
  await expect(page).toHaveURL(/\/analytics\/logs/);
  await expect(page.getByText('查看网关请求与错误详情', { exact: true })).toBeVisible();
  await expect(page.locator('.analytics-segment-tabs').getByRole('link', { name: '请求日志' })).toHaveClass(/active/);
  await expect(page.locator('.analytics-log-filters .tr-trigger')).toHaveCSS('min-height', '48px');
  await expect(page.getByLabel('状态', { exact: true })).toBeVisible();
  await expect(page.getByLabel('模型', { exact: true })).toBeVisible();
  await expect(page.getByLabel('密钥', { exact: true })).toBeVisible();
  await expect(page.getByLabel('渠道', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '请求日志' })).toBeVisible();
  await expect(page.getByRole('button', { name: '清空日志' })).toHaveCount(0);
  // Settings moved to the system page
  await page.locator('.sidebar').getByRole('link', { name: /系统设置/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '系统设置' })).toBeVisible();
  await expect(page.getByText('请求日志总开关')).toBeVisible();
  await expect(page.getByText('记录上下文')).toBeVisible();
  await expect(page.getByText('日志维护', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '清空日志' })).toBeVisible();
  await page.getByRole('button', { name: '清空日志' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确定' }).click();
  await expect(page.getByRole('status')).toContainText(/已清空 \d+ 条日志/);
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
