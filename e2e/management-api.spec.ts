import { expect, test, type APIRequestContext } from '@playwright/test';
import { loginViaApi, resetState } from './helpers';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const providerSecret = `provider-secret-${run}`;

async function createManagementKey(
  request: APIRequestContext,
  permission: 'read' | 'write',
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
) {
  await loginViaApi(request);
  const response = await request.post('/admin/api/management-keys', {
    data: { name: `${permission}-${run}`, permission, expires_at: expiresAt },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json();
  expect(body.key).toMatch(/^mgmt_/);
  expect(body.key_hash).toBeUndefined();
  return body;
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

test.beforeAll(async ({ request }) => {
  await resetState(request);
});

test.afterAll(async ({ request }) => {
  await resetState(request);
});

test('discovery is public while protected routes reject missing and wrong key types', async ({ request }) => {
  const hostedSkills = await request.get('/skills/index.json');
  expect(hostedSkills.status()).toBe(200);
  expect(await hostedSkills.json()).toMatchObject({ skills: [{ name: 'mygateway-admin', api_version: 'v1' }] });
  const hostedSkill = await request.get('/skill.md');
  expect(hostedSkill.status()).toBe(200);
  const hostedSkillText = await hostedSkill.text();
  expect(hostedSkillText).toContain('name: mygateway-admin');
  expect(hostedSkillText).toContain('No repository checkout, local helper script');
  expect(hostedSkillText).toContain('start=UNIX_SECONDS&end=UNIX_SECONDS');
  expect(hostedSkillText).not.toContain('from=UNIX_SECONDS&to=UNIX_SECONDS');
  expect(hostedSkillText).toContain('temporary keys cannot be renewed');
  expect(hostedSkillText).not.toContain('scripts/mygateway');
  expect((await request.get('/skill.json')).status()).toBe(200);

  const capabilities = await request.get('/management/v1/capabilities');
  expect(capabilities.status()).toBe(200);
  expect(await capabilities.json()).toMatchObject({ api_version: 'v1', permissions: ['read', 'write'] });
  const openApiResponse = await request.get('/management/v1/openapi.json');
  expect(openApiResponse.status()).toBe(200);
  const openApi = await openApiResponse.json();
  expect(Object.keys(openApi.paths)).toEqual(expect.arrayContaining([
    '/channels/{id}/models/import', '/models/{id}/instances',
    '/gateway-keys/{id}/regenerate', '/analytics/usage', '/logs/{id}',
  ]));
  expect(openApi.paths['/models'].get['x-required-permission']).toBe('read');
  expect(openApi.paths['/models'].post['x-required-permission']).toBe('write');

  expect((await request.get('/management/v1/system/status')).status()).toBe(401);
  expect((await request.get('/management/v1/system/status', { headers: auth('sk-not-a-management-key') })).status()).toBe(401);
  expect((await request.get('/admin/api/channels', { headers: auth('mgmt_not-a-real-management-key-value') })).status()).toBe(401);
  expect((await request.get('/v1/models', { headers: auth('mgmt_not-a-real-management-key-value') })).status()).toBe(401);
});

test('read keys inspect resources but cannot mutate', async ({ request }) => {
  const key = await createManagementKey(request, 'read');
  const status = await request.get('/management/v1/system/status', { headers: auth(key.key) });
  expect(status.status()).toBe(200);
  expect(status.headers()['x-gateway-request-id']).toBeTruthy();
  expect((await request.get('/management/v1/channels', { headers: auth(key.key) })).status()).toBe(200);
  expect((await request.get('/management/v1/models', { headers: auth(key.key) })).status()).toBe(200);
  expect((await request.get('/management/v1/analytics/usage', { headers: auth(key.key) })).status()).toBe(200);
  expect((await request.get('/management/v1/logs', { headers: auth(key.key) })).status()).toBe(200);
  await expect.poll(async () => {
    const rows = await request.get('/admin/api/management-keys').then((response) => response.json());
    return rows.find((row: any) => row.id === key.id)?.last_used_at;
  }).toBeTruthy();

  const denied = await request.post('/management/v1/models', {
    headers: auth(key.key), data: { unified_model_id: `denied-${run}`, display_name: 'Denied' },
  });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe('insufficient_permission');
});

test('write keys manage common resources without ever returning Provider Keys', async ({ request }) => {
  const key = await createManagementKey(request, 'write');
  const headers = auth(key.key);
  const channelResponse = await request.post('/management/v1/channels', {
    headers,
    data: {
      name: `Agent Provider ${run}`,
      provider_type: 'openai_compatible',
      base_url: `https://agent-provider-${run}.example/v1`,
      api_key: providerSecret,
      protocols: [{
        protocol: 'openai_chat',
        base_url: `https://agent-provider-${run}.example/v1`,
        auth_scheme: 'bearer',
      }],
    },
  });
  expect(channelResponse.status(), await channelResponse.text()).toBe(201);
  const channel = await channelResponse.json();
  expect(JSON.stringify(channel)).not.toContain(providerSecret);
  expect(JSON.stringify(channel)).not.toMatch(/ciphertext|key_hash/);

  const edited = await request.patch(`/management/v1/channels/${channel.id}`, {
    headers, data: { name: `Agent Provider edited ${run}` },
  });
  expect(edited.status(), await edited.text()).toBe(200);
  expect(await edited.json()).toMatchObject({ name: `Agent Provider edited ${run}` });

  const listedText = await (await request.get('/management/v1/channels', { headers })).text();
  expect(listedText).not.toContain(providerSecret);
  expect(listedText).not.toMatch(/ciphertext|key_hash/);

  const modelResponse = await request.post('/management/v1/models', {
    headers, data: { unified_model_id: `agent-${run}`, display_name: 'Agent Model' },
  });
  expect(modelResponse.status(), await modelResponse.text()).toBe(201);
  const model = await modelResponse.json();
  const instance = await request.post(`/management/v1/models/${model.id}/instances`, {
    headers,
    data: { channel_id: channel.id, channel_model_id: 'upstream-model', public_model_alias: `agent-alias-${run}` },
  });
  expect(instance.status(), await instance.text()).toBe(201);

  const gatewayKey = await request.post('/management/v1/gateway-keys', {
    headers, data: { name: `Agent-created ${run}` },
  });
  expect(gatewayKey.status(), await gatewayKey.text()).toBe(201);
  const gatewayKeyBody = await gatewayKey.json();
  expect(gatewayKeyBody.key).toMatch(/^gw_/);
  const gatewayKeyList = await request.get('/management/v1/gateway-keys', { headers });
  expect(await gatewayKeyList.text()).not.toContain(gatewayKeyBody.key);

  expect((await request.get('/management/v1/balances', { headers })).status()).toBe(200);
  expect((await request.delete(`/management/v1/gateway-keys/${gatewayKeyBody.id}`, { headers })).status()).toBe(204);
  expect((await request.delete(`/management/v1/models/${model.id}`, { headers })).status()).toBe(204);
  expect((await request.delete(`/management/v1/channels/${channel.id}`, { headers })).status()).toBe(204);
});

test('management key list hides hashes and disable, delete, and expiry take effect', async ({ request }) => {
  const current = await createManagementKey(request, 'read');
  const listed = await request.get('/admin/api/management-keys').then((response) => response.json());
  const publicRow = listed.find((row: any) => row.id === current.id);
  expect(publicRow.key).toBeUndefined();
  expect(publicRow.key_hash).toBeUndefined();

  await request.put(`/admin/api/management-keys/${current.id}`, { data: { status: 'disabled' } });
  expect((await request.get('/management/v1/system/status', { headers: auth(current.key) })).status()).toBe(401);
  await request.put(`/admin/api/management-keys/${current.id}`, { data: { status: 'active' } });
  expect((await request.get('/management/v1/system/status', { headers: auth(current.key) })).status()).toBe(200);
  expect((await request.post(`/admin/api/management-keys/${current.id}/regenerate`)).status()).toBe(400);

  await request.delete(`/admin/api/management-keys/${current.id}`);
  expect((await request.get('/management/v1/system/status', { headers: auth(current.key) })).status()).toBe(401);
  const afterDelete = await request.get('/admin/api/management-keys').then((response) => response.json());
  expect(afterDelete.some((row: any) => row.id === current.id)).toBe(false);

  const expiring = await createManagementKey(request, 'read', Math.floor(Date.now() / 1000) + 2);
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  expect((await request.get('/management/v1/system/status', { headers: auth(expiring.key) })).status()).toBe(401);

  const permanentResponse = await request.post('/admin/api/management-keys', {
    data: { name: `permanent-${run}`, permission: 'read', expires_at: null },
  });
  expect(permanentResponse.status()).toBe(201);
  const permanent = await permanentResponse.json();
  expect(permanent.expires_at).toBeNull();
  expect((await request.get('/management/v1/system/status', { headers: auth(permanent.key) })).status()).toBe(200);
  await request.delete(`/admin/api/management-keys/${permanent.id}`);
});
