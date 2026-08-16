/**
 * Admin API and gateway edge-case regression suite.
 *
 * This suite uses only local D1 and deliberately non-routable provider URLs;
 * it never requires or sends a real Provider Key.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { loginViaApi, resetState, uniq } from './helpers';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const modelId = `api-model-${run}`;
const importedModelId = `api-import-${run}`;
let channelA: any;
let channelB: any;
let channelC: any;

const chatProtocol = (baseUrl: string) => ({
  protocol: 'openai_chat', base_url: baseUrl, auth_scheme: 'bearer',
});

async function createChannel(
  request: APIRequestContext,
  name: string,
  baseUrl: string,
  apiKey: string,
  protocols = [chatProtocol(baseUrl)],
) {
  const response = await request.post('/admin/api/channels', {
    data: { name, provider_type: 'openai_compatible', base_url: baseUrl, api_key: apiKey, protocols },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test.beforeAll(async ({ request }) => {
  await resetState(request);
});

test.afterAll(async ({ request }) => {
  await resetState(request);
});

test('channels: validates protocols, persists edits, status, and duplicate-key constraints', async ({ request }) => {
  await loginViaApi(request);
  const baseA = `https://provider-a-${run}.example/v1`;
  const protocols = [
    chatProtocol(baseA),
    { protocol: 'openai_responses', base_url: baseA, auth_scheme: 'bearer' },
    { protocol: 'anthropic_messages', base_url: `https://provider-a-${run}.example/anthropic`, auth_scheme: 'x_api_key', api_version: '2023-06-01' },
  ];
  channelA = await createChannel(request, 'Provider A', baseA, 'provider-key-a', protocols);
  channelB = await createChannel(request, 'Provider B', `https://provider-b-${run}.example/v1`, 'provider-key-b');
  channelC = await createChannel(request, 'Provider C', `https://provider-c-${run}.example/v1`, 'provider-key-c');

  expect(channelA.protocols.map((entry: any) => entry.protocol).sort()).toEqual([
    'anthropic_messages', 'openai_chat', 'openai_responses',
  ]);

  const noProtocols = await request.post('/admin/api/channels', {
    data: { name: 'No protocols', provider_type: 'openai_compatible', base_url: baseA, api_key: 'x', protocols: [] },
  });
  expect(noProtocols.status()).toBe(400);
  expect((await noProtocols.json()).error.code).toBe('invalid_request');

  const duplicateProtocols = await request.post('/admin/api/channels', {
    data: { name: 'Duplicate protocols', provider_type: 'openai_compatible', base_url: baseA, api_key: 'x', protocols: [chatProtocol(baseA), chatProtocol(baseA)] },
  });
  expect(duplicateProtocols.status()).toBe(400);

  const insecureUrl = await request.post('/admin/api/channels', {
    data: { name: 'Insecure', provider_type: 'openai_compatible', base_url: 'http://provider.example/v1', api_key: 'x' },
  });
  expect(insecureUrl.status()).toBe(400);

  const duplicate = await request.post('/admin/api/channels', {
    data: { name: 'Duplicate A', provider_type: 'openai_compatible', base_url: baseA, api_key: 'provider-key-a', protocols },
  });
  expect(duplicate.status()).toBe(409);
  expect((await duplicate.json()).error.code).toBe('resource_in_use');

  const editedBase = `https://provider-a-${run}.example/openai/v2`;
  const editResponse = await request.put(`/admin/api/channels/${channelA.id}`, {
    data: { name: 'Provider A edited', status: 'disabled', protocols: [chatProtocol(editedBase)] },
  });
  expect(editResponse.status()).toBe(200);
  const edited = await editResponse.json();
  expect(edited).toMatchObject({ name: 'Provider A edited', status: 'disabled', base_url: editedBase });
  expect(edited.protocols).toHaveLength(1);

  const enabled = await request.put(`/admin/api/channels/${channelA.id}`, { data: { status: 'active' } });
  expect((await enabled.json()).status).toBe('active');

  const duplicateOnEdit = await request.put(`/admin/api/channels/${channelB.id}`, {
    data: { api_key: 'provider-key-a', protocols: [chatProtocol(editedBase)] },
  });
  expect(duplicateOnEdit.status()).toBe(409);
  expect((await duplicateOnEdit.json()).error.code).toBe('resource_in_use');

  const listed = await request.get('/admin/api/channels').then((response) => response.json());
  expect(listed).toHaveLength(3);
  expect(listed.find((channel: any) => channel.id === channelA.id).protocols[0].base_url).toBe(editedBase);
});

test('channels: manual model inventory supports add, idempotent add, list, and delete', async ({ request }) => {
  await loginViaApi(request);
  const endpoint = `/admin/api/channels/${channelA.id}/models`;
  const first = await request.post(endpoint, { data: { model_id: 'manual/test-model', display_name: 'Manual Test Model' } });
  expect(first.status()).toBe(201);
  const second = await request.post(endpoint, { data: { model_id: 'manual/test-model', display_name: 'Updated Name' } });
  expect(second.status()).toBe(201);

  const inventory = await request.get(endpoint).then((response) => response.json());
  expect(inventory.models.filter((model: any) => model.provider_model_id === 'manual/test-model')).toHaveLength(1);

  const removed = await request.delete(`${endpoint}?model_id=${encodeURIComponent('manual/test-model')}`);
  expect(removed.status()).toBe(204);
  const afterDelete = await request.get(endpoint).then((response) => response.json());
  expect(afterDelete.models.some((model: any) => model.provider_model_id === 'manual/test-model')).toBe(false);

  expect((await request.post(endpoint, { data: { model_id: '' } })).status()).toBe(400);
  expect((await request.delete(endpoint)).status()).toBe(400);
});

test('models: covers CRUD, instance conflicts, pricing, currency, and reorder', async ({ request }) => {
  await loginViaApi(request);
  expect((await request.post('/admin/api/models', { data: { unified_model_id: 'missing-name' } })).status()).toBe(400);

  const createdResponse = await request.post('/admin/api/models', {
    data: { unified_model_id: modelId, display_name: 'API Model' },
  });
  expect(createdResponse.status()).toBe(201);
  const card = await createdResponse.json();

  const duplicateModel = await request.post('/admin/api/models', {
    data: { unified_model_id: modelId, display_name: 'Duplicate' },
  });
  expect(duplicateModel.status()).toBe(400);

  const firstInstance = await request.post(`/admin/api/models/${card.id}/instances`, {
    data: { channel_id: channelA.id, channel_model_id: 'upstream-a', public_model_alias: `alias-a-${run}` },
  });
  expect(firstInstance.status()).toBe(201);
  const firstBody = await firstInstance.json();
  const instanceA = firstBody.instances.find((instance: any) => instance.channel_id === channelA.id);

  const secondInstance = await request.post(`/admin/api/models/${card.id}/instances`, {
    data: { channel_id: channelB.id, channel_model_id: 'upstream-b', public_model_alias: `alias-b-${run}` },
  });
  expect(secondInstance.status()).toBe(201);
  const instanceB = (await secondInstance.json()).instances.find((instance: any) => instance.channel_id === channelB.id);

  const duplicateChannel = await request.post(`/admin/api/models/${card.id}/instances`, {
    data: { channel_id: channelA.id, channel_model_id: 'other-a', public_model_alias: `other-a-${run}` },
  });
  expect(duplicateChannel.status()).toBe(409);

  const otherCard = await request.post('/admin/api/models', {
    data: { unified_model_id: `other-${modelId}`, display_name: 'Other Model' },
  }).then((response) => response.json());
  const aliasConflict = await request.post(`/admin/api/models/${otherCard.id}/instances`, {
    data: { channel_id: channelC.id, channel_model_id: 'upstream-c', public_model_alias: `alias-a-${run}` },
  });
  expect(aliasConflict.status()).toBe(400);

  const pricing = await request.put(`/admin/api/models/${card.id}/instances/${instanceA.id}`, {
    data: {
      input_price_micros_per_million: 125000,
      output_price_micros_per_million: 250000,
      cache_input_price_micros_per_million: 62500,
      currency: 'CNY',
      supports_stream_usage: true,
    },
  });
  expect(pricing.status()).toBe(200);
  expect((await pricing.json()).instances.find((instance: any) => instance.id === instanceA.id)).toMatchObject({
    input_price_micros_per_million: 125000,
    output_price_micros_per_million: 250000,
    cache_input_price_micros_per_million: 62500,
    currency: 'CNY',
    supports_stream_usage: 1,
  });
  expect((await request.put(`/admin/api/models/${card.id}/instances/${instanceA.id}`, { data: { currency: 'EUR' } })).status()).toBe(400);
  expect((await request.put(`/admin/api/models/${card.id}/instances/${instanceA.id}`, { data: { input_price_micros_per_million: -1 } })).status()).toBe(400);

  const reordered = await request.put(`/admin/api/models/${card.id}/instances/reorder`, {
    data: { instance_ids: [instanceB.id, instanceA.id] },
  });
  expect(reordered.status()).toBe(200);
  expect((await reordered.json()).instances.sort((a: any, b: any) => a.sort_order - b.sort_order).map((instance: any) => instance.id)).toEqual([instanceB.id, instanceA.id]);

  const edited = await request.put(`/admin/api/models/${card.id}`, {
    data: { display_name: 'API Model edited', status: 'disabled' },
  });
  expect(edited.status()).toBe(200);
  expect(await edited.json()).toMatchObject({ display_name: 'API Model edited', status: 'disabled' });

  expect((await request.delete(`/admin/api/models/${card.id}`)).status()).toBe(204);
  const recreated = await request.post('/admin/api/models', {
    data: { unified_model_id: modelId, display_name: 'API Model recreated' },
  });
  expect(recreated.status()).toBe(201);
});

test('model import: validates inventory, stays idempotent, and rejects oversized batches', async ({ request }) => {
  await loginViaApi(request);
  const inventoryEndpoint = `/admin/api/channels/${channelA.id}/models`;
  await request.post(inventoryEndpoint, { data: { model_id: 'provider-import-model', display_name: 'Provider Import Model' } });

  const importEndpoint = `/admin/api/channels/${channelA.id}/models/import`;
  const payload = { models: [{ provider_model_id: 'provider-import-model', unified_model_id: importedModelId }] };
  const first = await request.post(importEndpoint, { data: payload });
  expect(first.status()).toBe(200);
  expect((await first.json()).results[0]).toMatchObject({ ok: true, created: true, unified_model_id: importedModelId });

  const repeated = await request.post(importEndpoint, { data: payload });
  expect(repeated.status()).toBe(200);
  expect((await repeated.json()).results[0]).toMatchObject({ ok: true, created: false });
  const imported = await request.get('/admin/api/models').then((response) => response.json());
  expect(imported.find((model: any) => model.unified_model_id === importedModelId).instances).toHaveLength(1);

  const missing = await request.post(importEndpoint, {
    data: { models: [{ provider_model_id: 'not-in-inventory', unified_model_id: 'missing' }] },
  });
  expect((await missing.json()).results[0]).toMatchObject({ ok: false, error: 'Model is not in channel inventory' });

  const oversized = await request.post(importEndpoint, {
    data: { models: Array.from({ length: 101 }, (_, index) => ({ provider_model_id: `m-${index}` })) },
  });
  expect(oversized.status()).toBe(400);
});

test('gateway HTTP: enforces key state, allowlist, model availability, and protocol availability', async ({ request }) => {
  await loginViaApi(request);
  const legacyLimitResponse = await request.post('/admin/api/keys', {
    data: { name: uniq('legacy-daily'), daily_request_limit: 12, daily_token_limit: 34 },
  });
  expect(legacyLimitResponse.status()).toBe(201);
  const legacyLimitKey = await legacyLimitResponse.json();
  expect(legacyLimitKey).toMatchObject({
    request_limit: 12,
    token_limit: 34,
    limit_period: 'day',
    daily_request_limit: 12,
    daily_token_limit: 34,
  });
  expect((await request.post('/admin/api/keys', {
    data: { name: uniq('invalid-period'), token_limit: 10, limit_period: 'rolling' },
  })).status()).toBe(400);

  const chatBase = `https://chat-only-${run}.example/v1`;
  const chatChannel = await createChannel(request, 'Chat only', chatBase, 'chat-only-key');
  const routedModelId = `chat-only-model-${run}`;
  const routedCard = await request.post('/admin/api/models', {
    data: { unified_model_id: routedModelId, display_name: 'Chat only model', channel_id: chatChannel.id, channel_model_id: 'upstream-chat' },
  }).then((response) => response.json());
  expect(routedCard.instances).toHaveLength(1);

  const monthlyBudgetKey = await request.post('/admin/api/keys', {
    data: { name: uniq('monthly-budget'), request_limit: 0, token_limit: 1_000, limit_period: 'month' },
  }).then((response) => response.json());
  const monthlyBudgetCall = await request.post('/v1/chat/completions', {
    headers: { Authorization: `Bearer ${monthlyBudgetKey.key}` },
    data: { model: routedModelId, messages: [{ role: 'user', content: 'hi' }] },
  });
  expect(monthlyBudgetCall.status()).toBe(403);
  expect(await monthlyBudgetCall.json()).toMatchObject({
    error: { code: 'budget_exceeded', message: 'Monthly request budget exceeded for this API key' },
  });

  const restrictedResponse = await request.post('/admin/api/keys', {
    data: { name: uniq('restricted'), model_allowlist: ['another-model'] },
  });
  const restricted = await restrictedResponse.json();
  const restrictedCall = await request.post('/v1/chat/completions', {
    headers: { Authorization: `Bearer ${restricted.key}` },
    data: { model: routedModelId, messages: [{ role: 'user', content: 'hi' }] },
  });
  expect(restrictedCall.status()).toBe(403);
  expect((await restrictedCall.json()).error.code).toBe('model_not_allowed');

  await request.put(`/admin/api/keys/${restricted.id}`, { data: { status: 'disabled' } });
  const disabledKeyCall = await request.post('/v1/chat/completions', {
    headers: { Authorization: `Bearer ${restricted.key}` },
    data: { model: routedModelId, messages: [{ role: 'user', content: 'hi' }] },
  });
  expect(disabledKeyCall.status()).toBe(401);

  const active = await request.post('/admin/api/keys', { data: { name: uniq('active') } }).then((response) => response.json());
  const unknown = await request.post('/v1/chat/completions', {
    headers: { Authorization: `Bearer ${active.key}` },
    data: { model: `unknown-${run}`, messages: [{ role: 'user', content: 'hi' }] },
  });
  expect(unknown.status()).toBe(404);
  expect((await unknown.json()).error.code).toBe('model_not_found');

  const responsesUnavailable = await request.post('/v1/responses', {
    headers: { Authorization: `Bearer ${active.key}` },
    data: { model: routedModelId, input: 'hi' },
  });
  expect(responsesUnavailable.status()).toBe(422);
  expect((await responsesUnavailable.json()).error.code).toBe('protocol_unavailable');

  await request.put(`/admin/api/channels/${chatChannel.id}`, { data: { status: 'disabled' } });
  const unavailable = await request.post('/v1/chat/completions', {
    headers: { Authorization: `Bearer ${active.key}` },
    data: { model: routedModelId, messages: [{ role: 'user', content: 'hi' }] },
  });
  expect(unavailable.status()).toBe(503);
  expect((await unavailable.json()).error.code).toBe('model_unavailable');
});
