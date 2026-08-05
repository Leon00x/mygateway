/**
 * E2E: real DeepSeek integration — proves the gateway actually talks to a live provider.
 *
 * Uses the real provider key from .dev.vars (DEEPSEEK_TEST_KEY).
 * Skipped when the key is missing (e.g. CI without secrets).
 *
 * Flow:
 *   1. preflight without persistence, then add channel with its model result
 *   2. channel connection test → 200
 *   3. official account balance query → exact monetary strings
 *   4. import a discovered model
 *   5. create gateway key
 *   6. non-streaming chat via gateway → real completion + usage
 *   7. streaming chat via gateway → [DONE] + usage chunk
 *   8. native Anthropic Messages non-stream and stream
 *   9. admin usage overview reflects the calls
 */

import { test, expect } from '@playwright/test';
import { devVar, loginViaApi, loginViaUi, resetState, uniq } from './helpers';

const providerKey = devVar('DEEPSEEK_TEST_KEY');

test.describe.configure({ mode: 'serial' });

// Skip whole suite when no real key configured
test.skip(!providerKey, 'DEEPSEEK_TEST_KEY not set in .dev.vars — skipping real integration test');

const upstreamModel = 'deepseek-v4-flash';
const channelName = 'DeepSeek';
const modelId = upstreamModel;
let alias = '';
let gwKey = '';

test.beforeAll(async ({ request }) => {
  await resetState(request);
});

test('realtime: UI preflight then save and import', async ({ page }) => {
  await loginViaUi(page);
  await page.locator('.sidebar').getByRole('link', { name: /渠道/ }).click();
  await page.getByRole('button', { name: '+ 添加供应商' }).click();
  await page.getByRole('button', { name: /DeepSeek/ }).first().click();
  await page.getByPlaceholder('sk-...').fill(providerKey!);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '检测连接与模型' }).click();
  await expect(page.getByText(/检测成功 · 2 个模型/)).toBeVisible({ timeout: 15_000 });
  const preflightList = page.locator('.preflight-model-list');
  await expect(preflightList.getByText('deepseek-v4-flash', { exact: true })).toBeVisible();
  await expect(preflightList.getByText('deepseek-v4-pro', { exact: true })).toBeVisible();
  await expect(page.getByText('已选 2 / 2')).toBeVisible();
  await preflightList.locator('label', { hasText: 'deepseek-v4-pro' }).locator('input[type="checkbox"]').uncheck();
  await expect(page.getByText('已选 1 / 2')).toBeVisible();
  // A successful preflight still must not persist a draft channel.
  expect(await page.request.get('/admin/api/channels').then((response) => response.json())).toHaveLength(0);
  await page.getByRole('button', { name: '保存并导入 1 个模型' }).click();
  const detail = page.locator('.channel-detail-modal');
  await expect(detail.getByRole('heading', { name: channelName })).toBeVisible({ timeout: 15_000 });
  await expect(detail.locator('.catalog-row', { hasText: upstreamModel }).getByText('已导入')).toBeVisible({ timeout: 15_000 });
  await expect(detail.locator('.catalog-row', { hasText: 'deepseek-v4-pro' }).getByText('已导入')).toHaveCount(0);

  const channels = await page.request.get('/admin/api/channels').then((response) => response.json());
  const ch = channels.find((channel: any) => channel.name === channelName);
  expect(ch.has_api_key).toBe(true);
  expect(ch.protocols.map((protocol: any) => protocol.protocol)).toEqual([
    'anthropic_messages', 'openai_chat',
  ]);
});

test('realtime: channel connection test returns 200', async ({ request }) => {
  await loginViaApi(request);
  const channels = await request.get('/admin/api/channels').then((r) => r.json());
  const ch = channels.find((c: any) => c.name === channelName);
  expect(ch).toBeTruthy();

  const t = await request.post(`/admin/api/channels/${ch.id}/test`);
  const body = await t.json();
  expect(body.ok).toBe(true);
  expect(body.status).toBe(200);
});

test('realtime: official DeepSeek balance returns exact monetary strings', async ({ request }) => {
  await loginViaApi(request);
  const channels = await request.get('/admin/api/channels').then((r) => r.json());
  const ch = channels.find((c: any) => c.name === channelName);

  const response = await request.get(`/admin/api/channels/${ch.id}/balance?refresh=1`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.provider).toBe('deepseek');
  expect(body.status).toBe('ok');
  expect(typeof body.is_available).toBe('boolean');
  expect(Array.isArray(body.balance_infos)).toBe(true);
  for (const item of body.balance_infos) {
    expect(item.currency).toMatch(/^(CNY|USD)$/);
    expect(item.total_balance).toMatch(/^\d+(?:\.\d+)?$/);
    expect(item.granted_balance).toMatch(/^\d+(?:\.\d+)?$/);
    expect(item.topped_up_balance).toMatch(/^\d+(?:\.\d+)?$/);
  }
});

test('realtime: preflight inventory was imported without rediscovery', async ({ request }) => {
  await loginViaApi(request);
  const channels = await request.get('/admin/api/channels').then((r) => r.json());
  const ch = channels.find((c: any) => c.name === channelName);
  // The preflight result is reused on save, so opening inventory does not make
  // a second provider request.
  const discovery = await request.get(`/admin/api/channels/${ch.id}/models`);
  expect(discovery.ok()).toBeTruthy();
  const discovered = await discovery.json();
  expect(discovered.models.map((model: any) => model.provider_model_id)).toEqual(
    expect.arrayContaining(['deepseek-v4-flash', 'deepseek-v4-pro']),
  );

  const models = await request.get('/admin/api/models').then((response) => response.json());
  const imported = models.find((model: any) => model.unified_model_id === modelId);
  expect(imported?.instances).toHaveLength(1);
  expect(models.some((model: any) => model.unified_model_id === 'deepseek-v4-pro')).toBe(false);
  alias = imported.instances[0].public_model_alias;
  expect(alias).toContain('deepseek-v4-flash');
});

test('realtime: create gateway key', async ({ request }) => {
  await loginViaApi(request);
  const resp = await request.post('/admin/api/keys', {
    data: { name: uniq('e2e-real') },
  });
  expect(resp.ok()).toBeTruthy();
  gwKey = (await resp.json()).key;
  expect(gwKey).toMatch(/^gw_[A-Za-z0-9_-]{20,}/);
});

test('realtime: non-streaming chat → real completion + usage', async ({ request }) => {
  expect(gwKey).toBeTruthy();

  const resp = await request.post('/v1/chat/completions', {
    headers: { Authorization: `Bearer ${gwKey}`, 'Content-Type': 'application/json' },
    data: {
      model: modelId,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      stream: false,
    },
    timeout: 60_000,
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();

  const content = body.choices?.[0]?.message?.content ?? '';
  expect(content.trim().length).toBeGreaterThan(0);
  expect(body.usage).toBeTruthy();
  expect(body.usage.total_tokens).toBeGreaterThan(0);
});

test('realtime: streaming chat → [DONE] + usage chunk', async ({ request }) => {
  expect(gwKey).toBeTruthy();

  const resp = await request.post('/v1/chat/completions', {
    headers: { Authorization: `Bearer ${gwKey}`, 'Content-Type': 'application/json' },
    data: {
      model: alias, // use the full alias this time
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      stream: true,
    },
    timeout: 60_000,
  });
  expect(resp.status()).toBe(200);

  const text = await resp.text();
  const lines = text.split('\n').filter((l) => l.startsWith('data: '));

  expect(lines.length).toBeGreaterThan(1);
  expect(lines.at(-1)).toContain('[DONE]');

  // A chunk carrying final usage must exist
  const usageChunk = lines.find((l) => l.includes('"usage":{') && l.includes('"total_tokens"'));
  expect(usageChunk, 'final usage chunk should be present').toBeTruthy();
});

test('realtime: native DeepSeek Anthropic Messages', async ({ request }) => {
  const resp = await request.post('/v1/messages', {
    headers: { 'x-api-key': gwKey, 'anthropic-version': '2023-06-01' },
    data: {
      model: modelId,
      max_tokens: 128,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      stream: false,
    },
    timeout: 60_000,
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.type).toBe('message');
  expect(body.role).toBe('assistant');
  expect(body.content?.some((block: any) => block.type === 'text' && block.text.length > 0)).toBe(true);
  expect(body.usage.input_tokens).toBeGreaterThan(0);
  expect(body.usage.output_tokens).toBeGreaterThan(0);
});

test('realtime: native DeepSeek Messages stream emits Anthropic events', async ({ request }) => {
  const resp = await request.post('/v1/messages', {
    headers: { 'x-api-key': gwKey, 'anthropic-version': '2023-06-01' },
    data: {
      model: alias,
      max_tokens: 128,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      stream: true,
    },
    timeout: 60_000,
  });
  expect(resp.status()).toBe(200);
  const text = await resp.text();
  expect(text).toContain('event: message_start');
  expect(text).toContain('event: content_block_delta');
  expect(text).toContain('event: message_delta');
  expect(text).toContain('event: message_stop');
  expect(text).toContain('"type":"text_delta"');
});

test('realtime: admin usage overview reflects the calls', async ({ request }) => {
  await loginViaApi(request);

  const overview = await request.get('/admin/api/usage/overview?range=today').then((r) => r.json());
  expect(overview.requests).toBeGreaterThanOrEqual(4);
  expect(overview.successes).toBeGreaterThanOrEqual(4);
  expect(overview.input_tokens).toBeGreaterThan(0);
  expect(overview.output_tokens).toBeGreaterThan(0);
});

test.afterAll(async ({ request }) => {
  await resetState(request);
});
