/**
 * Focused reproduction for the dashboard provider-balance refresh flow.
 *
 * Mocks D1 (listChannels / getChannel / summaries), key decryption, and the
 * upstream DeepSeek balance endpoint, then exercises the admin handlers
 * exactly the way the dashboard does:
 *   - initial load: GET /admin/api/channels/balances            (cache-only)
 *   - dashboard refresh: GET /admin/api/channels/balances?refresh=1&active=1
 *   - channels page per-channel: GET /admin/api/channels/:id/balance?refresh=1
 *   - overview: GET /admin/api/channels/overview                (cache-only)
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env } from '../src/env.ts';

const { CHANNEL_ID, UPSTREAM_BODY } = vi.hoisted(() => {
  return {
    CHANNEL_ID: 'ch_deepseek_1',
    UPSTREAM_BODY: {
      is_available: true,
      balance_infos: [{
        currency: 'CNY', total_balance: '42.10', granted_balance: '2.00', topped_up_balance: '40.10',
      }],
    },
  };
});

vi.mock('../src/db/channels.ts', () => {
  const channel = {
    id: CHANNEL_ID,
    name: 'DeepSeek',
    provider_type: 'openai_compatible',
    base_url: 'https://api.deepseek.com',
    api_key_ciphertext: 'ct',
    api_key_iv: 'iv',
    api_key_version: 1,
    status: 'active',
    notes: null,
    preset_id: 'deepseek',
    short_code: 'deepseek',
    created_at: 1,
    updated_at: 1,
    protocols: [{ protocol: 'openai_chat', base_url: 'https://api.deepseek.com/v1', auth_scheme: 'bearer', api_version: null }],
  };
  return {
    listChannels: vi.fn(async () => [channel]),
    getChannel: vi.fn(async (_db: unknown, id: string) => (id === CHANNEL_ID ? channel : null)),
    toPublicChannel: vi.fn((row: Record<string, unknown>) => ({
      id: row.id, name: row.name, provider_type: row.provider_type, base_url: row.base_url,
      has_api_key: true, status: row.status, notes: row.notes, preset_id: row.preset_id,
      short_code: row.short_code, created_at: row.created_at, updated_at: row.updated_at,
      protocols: row.protocols,
    })),
  };
});

vi.mock('../src/db/provider-models.ts', () => ({
  listChannelModelSummaries: vi.fn(async () => []),
}));

vi.mock('../src/crypto/provider-key.ts', () => ({
  decryptProviderKey: vi.fn(async () => 'ds-test-key'),
}));

const env = { DB: {}, MASTER_KEY: 'x' } as unknown as Env;

const json = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

function getRequest(url: string): Request {
  return new Request(`http://test.local${url}`, { method: 'GET' });
}

describe('dashboard provider balance refresh', () => {
  let handleChannelBalances: typeof import('../src/admin/provider-balances.ts')['handleChannelBalances'];
  let handleChannelBalance: typeof import('../src/admin/provider-balances.ts')['handleChannelBalance'];
  let handleChannelOverview: typeof import('../src/admin/channel-overview.ts')['handleChannelOverview'];
  let fetchMock: ReturnType<typeof vi.fn>;
  let balanceValue: Record<string, unknown>;

  beforeEach(async () => {
    balanceValue = structuredClone(UPSTREAM_BODY);
    fetchMock = vi.fn(async () => new Response(JSON.stringify(balanceValue), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
    // Re-import after reset so each test starts with an empty isolate cache.
    ({ handleChannelBalances, handleChannelBalance } = await import('../src/admin/provider-balances.ts'));
    ({ handleChannelOverview } = await import('../src/admin/channel-overview.ts'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('initial load is not_queried, dashboard refresh returns fresh data', async () => {
    const initial = await handleChannelBalances(getRequest('/admin/api/channels/balances'), new URL('http://test.local/admin/api/channels/balances'), env);
    expect((await json(initial)).balances).toMatchObject([{ channel_id: CHANNEL_ID, status: 'not_queried' }]);

    const refreshed = await handleChannelBalances(
      getRequest('/admin/api/channels/balances?refresh=1&active=1'),
      new URL('http://test.local/admin/api/channels/balances?refresh=1&active=1'),
      env,
    );
    expect((await json(refreshed)).balances).toMatchObject([{
      channel_id: CHANNEL_ID,
      status: 'ok',
      cached: false,
      balance_infos: [{ total_balance: '42.10' }],
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a second force refresh re-queries upstream instead of serving the cache', async () => {
    await handleChannelBalances(
      getRequest('/admin/api/channels/balances?refresh=1&active=1'),
      new URL('http://test.local/admin/api/channels/balances?refresh=1&active=1'),
      env,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Balance changes upstream between refreshes.
    (balanceValue.balance_infos as Array<Record<string, unknown>>)[0].total_balance = '77.77';

    const refreshed = await handleChannelBalances(
      getRequest('/admin/api/channels/balances?refresh=1&active=1'),
      new URL('http://test.local/admin/api/channels/balances?refresh=1&active=1'),
      env,
    );
    const body = await json(refreshed);
    expect(body.balances).toMatchObject([{ channel_id: CHANNEL_ID, status: 'ok', cached: false }]);
    expect((body.balances as Array<{ balance_infos: Array<{ total_balance: string }> }>)[0].balance_infos[0].total_balance).toBe('77.77');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('dashboard load after a refresh serves the five-minute cache', async () => {
    await handleChannelBalances(
      getRequest('/admin/api/channels/balances?refresh=1&active=1'),
      new URL('http://test.local/admin/api/channels/balances?refresh=1&active=1'),
      env,
    );
    const cached = await handleChannelBalances(
      getRequest('/admin/api/channels/balances'),
      new URL('http://test.local/admin/api/channels/balances'),
      env,
    );
    expect((await json(cached)).balances).toMatchObject([{
      channel_id: CHANNEL_ID, status: 'ok', cached: true,
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('single-channel refresh then overview keeps the fresh value visible', async () => {
    const single = await handleChannelBalance(
      getRequest(`/admin/api/channels/${CHANNEL_ID}/balance?refresh=1`),
      new URL(`http://test.local/admin/api/channels/${CHANNEL_ID}/balance?refresh=1`),
      CHANNEL_ID,
      env,
    );
    expect(await json(single)).toMatchObject({ status: 'ok', cached: false, channel_id: CHANNEL_ID });

    const overview = await handleChannelOverview(getRequest('/admin/api/channels/overview'), env);
    expect((await json(overview)).balances).toMatchObject([{ channel_id: CHANNEL_ID, status: 'ok', cached: true }]);
  });

  test('a channel edit during an in-flight query neither errors nor backfills the cache', async () => {
    // Defer the upstream response so the query stays in flight while the
    // channel is edited (PUT/DELETE invalidates the balance cache generation).
    let release!: (body: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => {
      release = (body) => resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }));

    const { invalidateProviderBalanceCache } = await import('../src/admin/provider-balances.ts');
    const pending = handleChannelBalance(
      getRequest(`/admin/api/channels/${CHANNEL_ID}/balance?refresh=1`),
      new URL(`http://test.local/admin/api/channels/${CHANNEL_ID}/balance?refresh=1`),
      CHANNEL_ID,
      env,
    );
    // Wait until the query captured its generation and is awaiting upstream,
    // then edit the channel while the fetch is still in flight.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    invalidateProviderBalanceCache(CHANNEL_ID);
    release(UPSTREAM_BODY);

    const result = await pending;
    const body = await json(result);
    expect(body).toMatchObject({ channel_id: CHANNEL_ID, status: 'not_queried' });

    // The stale result must not be cached: a cache-only read stays not_queried.
    const cached = await handleChannelBalances(
      getRequest('/admin/api/channels/balances'),
      new URL('http://test.local/admin/api/channels/balances'),
      env,
    );
    expect((await json(cached)).balances).toMatchObject([{ channel_id: CHANNEL_ID, status: 'not_queried' }]);
  });
});
