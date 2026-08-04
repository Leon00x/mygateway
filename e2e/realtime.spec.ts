/**
 * E2E: real DeepSeek integration — proves the gateway actually talks to a live provider.
 *
 * Uses the real provider key from .dev.vars (DEEPSEEK_TEST_KEY).
 * Skipped when the key is missing (e.g. CI without secrets).
 *
 * Flow:
 *   1. add channel with real key
 *   2. channel connection test → 200
 *   3. create model card + instance
 *   4. create gateway key
 *   5. non-streaming chat via gateway → real completion + usage
 *   6. streaming chat via gateway → [DONE] + usage chunk
 *   7. admin usage overview reflects the calls
 */

import { test, expect } from '@playwright/test';
import { devVar, loginViaApi, resetState, uniq } from './helpers';

const providerKey = devVar('DEEPSEEK_TEST_KEY');

test.describe.configure({ mode: 'serial' });

// Skip whole suite when no real key configured
test.skip(!providerKey, 'DEEPSEEK_TEST_KEY not set in .dev.vars — skipping real integration test');

const upstreamModel = 'deepseek-v4-flash';
const channelName = uniq('DS');
const modelId = uniq('ds4');
const alias = uniq('ds4-alias-');
let gwKey = '';

test.beforeAll(async ({ request }) => {
  await resetState(request);
});

test('realtime: add channel with real key', async ({ request }) => {
  await loginViaApi(request);
  const resp = await request.post('/admin/api/channels', {
    data: {
      name: channelName,
      provider_type: 'openai_compatible',
      base_url: 'https://api.deepseek.com/v1',
      api_key: providerKey,
    },
  });
  expect(resp.ok()).toBeTruthy();
  const ch = await resp.json();
  expect(ch.has_api_key).toBe(true);
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

test('realtime: create model + instance', async ({ request }) => {
  await loginViaApi(request);
  const channels = await request.get('/admin/api/channels').then((r) => r.json());
  const ch = channels.find((c: any) => c.name === channelName);

  const m = await request.post('/admin/api/models', {
    data: { unified_model_id: modelId, display_name: 'E2E Real' },
  });
  expect(m.ok()).toBeTruthy();
  const card = await m.json();

  const inst = await request.post(`/admin/api/models/${card.id}/instances`, {
    data: {
      channel_id: ch.id,
      channel_model_id: upstreamModel,
      public_model_alias: alias,
      sort_order: 0,
      supports_stream_usage: true,
    },
  });
  expect(inst.ok()).toBeTruthy();
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

test('realtime: admin usage overview reflects the calls', async ({ request }) => {
  await loginViaApi(request);

  const overview = await request.get('/admin/api/usage/overview?range=today').then((r) => r.json());
  expect(overview.requests).toBeGreaterThanOrEqual(2);
  expect(overview.successes).toBeGreaterThanOrEqual(2);
  expect(overview.input_tokens).toBeGreaterThan(0);
  expect(overview.output_tokens).toBeGreaterThan(0);
});

test.afterAll(async ({ request }) => {
  await resetState(request);
});
