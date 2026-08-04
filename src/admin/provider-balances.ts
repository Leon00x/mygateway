/** Provider account balance queries for the admin console. */

import type { Env } from '../env.ts';
import { decryptProviderKey } from '../crypto/provider-key.ts';
import { getChannel, listChannels, type ChannelWithProtocols } from '../db/channels.ts';

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
const BALANCE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_BALANCE_CACHE_ENTRIES = 200;
const MAX_BALANCE_RESPONSE_BYTES = 64 * 1024;

export interface ProviderBalanceInfo {
  currency: 'CNY' | 'USD';
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

export interface DeepSeekBalance {
  is_available: boolean;
  balance_infos: ProviderBalanceInfo[];
}

export type ProviderBalanceResult = {
  channel_id: string;
  channel_name: string;
  provider: 'deepseek';
  status: 'not_queried';
} | {
  channel_id: string;
  channel_name: string;
  provider: 'deepseek';
  status: 'ok';
  cached: boolean;
  fetched_at: number;
  is_available: boolean;
  balance_infos: ProviderBalanceInfo[];
} | {
  channel_id: string;
  channel_name: string;
  provider: 'deepseek';
  status: 'error';
  error: string;
};

interface CachedBalance {
  value: DeepSeekBalance;
  fetchedAt: number;
  expiresAt: number;
}

const balanceCache = new Map<string, CachedBalance>();
const inFlight = new Map<string, Promise<ProviderBalanceResult>>();
const inFlightTokens = new Map<string, symbol>();
const cacheGeneration = new Map<string, number>();

function balanceJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isOfficialDeepSeekUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === 'api.deepseek.com';
  } catch {
    return false;
  }
}

/** Only DeepSeek's official API key can query the official account balance. */
export function isOfficialDeepSeekChannel(
  channel: Pick<ChannelWithProtocols, 'base_url' | 'protocols'>,
): boolean {
  return isOfficialDeepSeekUrl(channel.base_url)
    || channel.protocols.some((protocol) => isOfficialDeepSeekUrl(protocol.base_url));
}

function decimalString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Invalid DeepSeek balance field '${field}'`);
  }
  return value;
}

/** Parse without floating-point conversion so displayed monetary values stay exact. */
export function parseDeepSeekBalance(value: unknown): DeepSeekBalance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid DeepSeek balance response');
  }
  const body = value as Record<string, unknown>;
  if (typeof body.is_available !== 'boolean' || !Array.isArray(body.balance_infos)) {
    throw new Error('Invalid DeepSeek balance response');
  }

  const balanceInfos = body.balance_infos.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Invalid DeepSeek balance_infos[${index}]`);
    }
    const item = raw as Record<string, unknown>;
    if (item.currency !== 'CNY' && item.currency !== 'USD') {
      throw new Error(`Invalid DeepSeek balance currency at index ${index}`);
    }
    const currency: ProviderBalanceInfo['currency'] = item.currency;
    return {
      currency,
      total_balance: decimalString(item.total_balance, `balance_infos[${index}].total_balance`),
      granted_balance: decimalString(item.granted_balance, `balance_infos[${index}].granted_balance`),
      topped_up_balance: decimalString(item.topped_up_balance, `balance_infos[${index}].topped_up_balance`),
    };
  });

  return { is_available: body.is_available, balance_infos: balanceInfos };
}

export async function fetchDeepSeekBalance(
  providerApiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<DeepSeekBalance> {
  const response = await fetcher(DEEPSEEK_BALANCE_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${providerApiKey}`,
      'User-Agent': 'mygateway/0.1.0',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`DeepSeek balance request failed (HTTP ${response.status})`);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BALANCE_RESPONSE_BYTES) {
    throw new Error('DeepSeek balance response is too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('DeepSeek balance response is not valid JSON');
  }
  return parseDeepSeekBalance(parsed);
}

function readCached(channelId: string): CachedBalance | null {
  const entry = balanceCache.get(channelId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    balanceCache.delete(channelId);
    return null;
  }
  // Touch for bounded LRU behavior.
  balanceCache.delete(channelId);
  balanceCache.set(channelId, entry);
  return entry;
}

function storeCached(channelId: string, value: DeepSeekBalance): CachedBalance {
  const entry = { value, fetchedAt: Date.now(), expiresAt: Date.now() + BALANCE_CACHE_TTL_MS };
  balanceCache.delete(channelId);
  balanceCache.set(channelId, entry);
  while (balanceCache.size > MAX_BALANCE_CACHE_ENTRIES) {
    const oldest = balanceCache.keys().next().value as string | undefined;
    if (!oldest) break;
    balanceCache.delete(oldest);
  }
  return entry;
}

function successResult(
  channel: Pick<ChannelWithProtocols, 'id' | 'name'>,
  entry: CachedBalance,
  cached: boolean,
): ProviderBalanceResult {
  return {
    channel_id: channel.id,
    channel_name: channel.name,
    provider: 'deepseek',
    status: 'ok',
    cached,
    fetched_at: Math.floor(entry.fetchedAt / 1000),
    ...entry.value,
  };
}

function notQueriedResult(
  channel: Pick<ChannelWithProtocols, 'id' | 'name'>,
): ProviderBalanceResult {
  return {
    channel_id: channel.id,
    channel_name: channel.name,
    provider: 'deepseek',
    status: 'not_queried',
  };
}

async function queryBalance(
  channel: ChannelWithProtocols,
  env: Env,
  forceRefresh: boolean,
): Promise<ProviderBalanceResult> {
  if (!forceRefresh) {
    const cached = readCached(channel.id);
    if (cached) return successResult(channel, cached, true);
  }

  const pending = inFlight.get(channel.id);
  if (pending) return pending;
  const generation = cacheGeneration.get(channel.id) ?? 0;
  const queryToken = Symbol(channel.id);
  inFlightTokens.set(channel.id, queryToken);

  const query = (async (): Promise<ProviderBalanceResult> => {
    // Defer work until both the promise and its token have been registered.
    await Promise.resolve();
    try {
      const providerKey = await decryptProviderKey(
        channel.api_key_ciphertext,
        channel.api_key_iv,
        env.MASTER_KEY,
        channel.id,
        channel.api_key_version,
      );
      const value = await fetchDeepSeekBalance(providerKey);
      if ((cacheGeneration.get(channel.id) ?? 0) !== generation) {
        throw new Error('Channel configuration changed; query the balance again');
      }
      return successResult(channel, storeCached(channel.id, value), false);
    } catch (error) {
      return {
        channel_id: channel.id,
        channel_name: channel.name,
        provider: 'deepseek',
        status: 'error',
        error: error instanceof Error ? error.message : 'DeepSeek balance request failed',
      };
    } finally {
      if (inFlightTokens.get(channel.id) === queryToken) {
        inFlightTokens.delete(channel.id);
        inFlight.delete(channel.id);
      }
    }
  })();

  inFlight.set(channel.id, query);
  return query;
}

export function invalidateProviderBalanceCache(channelId: string): void {
  balanceCache.delete(channelId);
  inFlight.delete(channelId);
  inFlightTokens.delete(channelId);
  const nextGeneration = (cacheGeneration.get(channelId) ?? 0) + 1;
  cacheGeneration.delete(channelId);
  cacheGeneration.set(channelId, nextGeneration);
  while (cacheGeneration.size > MAX_BALANCE_CACHE_ENTRIES) {
    const oldest = cacheGeneration.keys().next().value as string | undefined;
    if (!oldest) break;
    cacheGeneration.delete(oldest);
  }
}

/** GET /admin/api/channels/balances — cache-only unless refresh=1. */
export async function handleChannelBalances(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (request.method !== 'GET') return balanceJson({ error: 'Method not allowed' }, 405);
  const refresh = url.searchParams.get('refresh') === '1';
  let channels = (await listChannels(env.DB)).filter(isOfficialDeepSeekChannel);
  if (url.searchParams.get('active') === '1') {
    channels = channels.filter((channel) => channel.status === 'active');
  }
  const balances = await Promise.all(channels.map(async (channel) => {
    if (refresh) return queryBalance(channel, env, true);
    const cached = readCached(channel.id);
    return cached ? successResult(channel, cached, true) : notQueriedResult(channel);
  }));
  return balanceJson({ balances, cache_ttl_seconds: BALANCE_CACHE_TTL_MS / 1000 });
}

/** GET /admin/api/channels/:id/balance — on-demand query with five-minute cache. */
export async function handleChannelBalance(
  request: Request,
  url: URL,
  channelId: string,
  env: Env,
): Promise<Response> {
  if (request.method !== 'GET') return balanceJson({ error: 'Method not allowed' }, 405);
  const channel = await getChannel(env.DB, channelId);
  if (!channel) return balanceJson({ error: 'Channel not found' }, 404);
  if (!isOfficialDeepSeekChannel(channel)) {
    return balanceJson({ error: 'Balance query is only supported for official DeepSeek channels' }, 422);
  }
  const result = await queryBalance(channel, env, url.searchParams.get('refresh') === '1');
  return balanceJson(result, result.status === 'error' ? 502 : 200);
}
