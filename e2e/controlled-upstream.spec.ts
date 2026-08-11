/**
 * Gateway integration tests backed by a controllable local Provider.
 *
 * No external Provider or real Provider Key is used. Every request travels
 * through the running Worker, its routing layer, and a local HTTP upstream.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { loginViaApi, resetState } from './helpers';
import { startFakeProvider, type FakeProvider } from './fake-provider';

test.describe.configure({ mode: 'serial' });

const gatewayBaseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:8799';
const configuredTimeoutMs = Number(process.env.E2E_UPSTREAM_TIMEOUT_MS ?? 0);
const run = Date.now().toString(36);
let sequence = 0;
let provider: FakeProvider;

type Route = {
  gatewayKey: string;
  modelId: string;
  upstreamModelId: string;
  primaryKey: string;
};

async function createRoute(request: APIRequestContext, primaryScenario: string, fallbackScenario?: string): Promise<Route> {
  await loginViaApi(request);
  const suffix = `${run}-${sequence++}`;
  const upstreamModelId = `provider-model-${suffix}`;
  const primaryKey = `provider-key-${suffix}-primary`;

  const createChannel = async (scenario: string, role: string, apiKey: string) => {
    const baseUrl = `${provider.baseUrl}/${scenario}/v1`;
    const response = await request.post('/admin/api/channels', {
      data: {
        name: `Controlled ${role} ${suffix}`,
        provider_type: 'openai_compatible',
        base_url: baseUrl,
        api_key: apiKey,
        protocols: [{ protocol: 'openai_chat', base_url: baseUrl, auth_scheme: 'bearer' }],
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  };

  const primary = await createChannel(primaryScenario, 'primary', primaryKey);
  const modelId = `controlled-model-${suffix}`;
  const modelResponse = await request.post('/admin/api/models', {
    data: {
      unified_model_id: modelId,
      display_name: `Controlled model ${suffix}`,
      channel_id: primary.id,
      channel_model_id: upstreamModelId,
    },
  });
  expect(modelResponse.status(), await modelResponse.text()).toBe(201);
  const model = await modelResponse.json();

  if (fallbackScenario) {
    const fallback = await createChannel(fallbackScenario, 'fallback', `provider-key-${suffix}-fallback`);
    const instanceResponse = await request.post(`/admin/api/models/${model.id}/instances`, {
      data: {
        channel_id: fallback.id,
        channel_model_id: upstreamModelId,
        public_model_alias: `controlled-fallback-${suffix}`,
      },
    });
    expect(instanceResponse.status(), await instanceResponse.text()).toBe(201);
  }

  const keyResponse = await request.post('/admin/api/keys', {
    data: { name: `Controlled key ${suffix}`, model_allowlist: [modelId] },
  });
  expect(keyResponse.status(), await keyResponse.text()).toBe(201);
  const gatewayKey = (await keyResponse.json()).key as string;
  return { gatewayKey, modelId, upstreamModelId, primaryKey };
}

async function gatewayFetch(route: Route, stream = false, signal?: AbortSignal) {
  return fetch(`${gatewayBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${route.gatewayKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: route.modelId,
      messages: [{ role: 'user', content: 'controlled request' }],
      stream,
    }),
    signal,
  });
}

test.beforeAll(async ({ request }) => {
  provider = await startFakeProvider();
  await resetState(request);
});

test.afterAll(async ({ request }) => {
  await resetState(request);
  await provider.close();
});

for (const scenario of ['retry-503', 'retry-429', 'drop'] as const) {
  test(`falls back after ${scenario}`, async ({ request }) => {
    const successesBefore = provider.count('success');
    const route = await createRoute(request, scenario, 'success');
    const response = await gatewayFetch(route);

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.choices[0].message.content).toBe('controlled upstream ok');
    expect(provider.count(scenario)).toBe(1);
    expect(provider.count('success')).toBe(successesBefore + 1);
    expect(provider.lastRequest(scenario)).toMatchObject({
      authorization: `Bearer ${route.primaryKey}`,
      body: { model: route.upstreamModelId, stream: false },
    });
  });
}

test('does not fall back after a non-retryable 401', async ({ request }) => {
  const successesBefore = provider.count('success');
  const route = await createRoute(request, 'auth-401', 'success');
  const response = await gatewayFetch(route);

  expect(response.status).toBe(401);
  expect(provider.count('auth-401')).toBe(1);
  expect(provider.count('success')).toBe(successesBefore);
});

test('falls back after the configured upstream header timeout', async ({ request }) => {
  test.skip(
    !Number.isFinite(configuredTimeoutMs) || configuredTimeoutMs <= 0,
    'Run the Worker with UPSTREAM_HEADER_TIMEOUT_MS and set the matching E2E_UPSTREAM_TIMEOUT_MS.',
  );
  expect(configuredTimeoutMs).toBeLessThan(5_000);
  const successesBefore = provider.count('success');
  const route = await createRoute(request, 'slow', 'success');
  const startedAt = Date.now();
  const response = await gatewayFetch(route);

  expect(response.status).toBe(200);
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(provider.count('slow')).toBe(1);
  expect(provider.count('success')).toBe(successesBefore + 1);
});

test('does not switch channels after a successful stream has started', async ({ request }) => {
  const successesBefore = provider.count('success');
  const route = await createRoute(request, 'stream-cut', 'success');
  const response = await gatewayFetch(route, true);

  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('first');
  try {
    while (!(await reader.read()).done) { /* consume until the controlled interruption */ }
  } catch { /* an interrupted upstream may surface as a rejected stream read */ }
  expect(provider.count('stream-cut')).toBe(1);
  expect(provider.count('success')).toBe(successesBefore);
});

test('propagates client cancellation to the active upstream stream', async ({ request }) => {
  const route = await createRoute(request, 'stream-live');
  const controller = new AbortController();
  const response = await gatewayFetch(route, true, controller.signal);
  expect(response.status).toBe(200);

  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('first');
  controller.abort();
  await provider.waitForCancellation('stream-live');
  expect(provider.count('stream-live')).toBe(1);
});
