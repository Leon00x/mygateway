/**
 * Admin channels API handlers.
 */

import { Env } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { generateId, nowSeconds } from '../shared/ids.ts';
import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  softDeleteChannel,
  softDeleteInstancesByChannel,
  getChannelDeleteImpact,
  softDeleteOrphanModelCards,
  toPublicChannel,
  ChannelRow,
  replaceChannelProtocols,
} from '../db/channels.ts';
import { encryptProviderKey } from '../crypto/provider-key.ts';
import { invalidateModelRouteCache } from '../gateway/access-resolver.ts';
import { channelCircuitBreaker } from '../gateway/passive-circuit-breaker.ts';
import { isGatewayProtocol, type ChannelProtocol, type GatewayProtocol } from '../gateway/protocols.ts';
import { invalidateProviderBalanceCache } from './provider-balances.ts';
import { getPresetById, providerShortCode } from '../shared/provider-presets.ts';
import { discoverProviderModels, persistDiscoveredProviderModels } from './model-discovery.ts';
import type { DiscoveredProviderModel } from '../db/provider-models.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Validate and normalize a base URL.
 */
function normalizeBaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  // Localhost may be plain HTTP — used for local dev servers and integration
  // tests; production gateways never see loopback addresses.
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error('Only HTTPS URLs are allowed');
  }
  if (parsed.username || parsed.password) throw new Error('URL must not contain credentials');
  if (parsed.search) throw new Error('URL must not contain query parameters');
  if (parsed.hash) throw new Error('URL must not contain fragment');
  // Remove trailing slash
  return parsed.href.replace(/\/+$/, '');
}

function normalizeProtocols(input: unknown, fallbackBaseUrl: string): ChannelProtocol[] {
  const source = input === undefined
    ? [{ protocol: 'openai_chat', base_url: fallbackBaseUrl, auth_scheme: 'bearer' }]
    : input;
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error('At least one provider protocol is required');
  }
  const seen = new Set<GatewayProtocol>();
  return source.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`protocols[${index}] must be an object`);
    const entry = raw as Record<string, unknown>;
    if (!isGatewayProtocol(entry.protocol)) throw new Error(`Invalid protocols[${index}].protocol`);
    if (seen.has(entry.protocol)) throw new Error(`Duplicate protocol '${entry.protocol}'`);
    seen.add(entry.protocol);
    const authScheme = entry.auth_scheme ?? (entry.protocol === 'anthropic_messages' ? 'x_api_key' : 'bearer');
    if (authScheme !== 'bearer' && authScheme !== 'x_api_key') {
      throw new Error(`Invalid protocols[${index}].auth_scheme`);
    }
    const baseUrl = normalizeBaseUrl(typeof entry.base_url === 'string' ? entry.base_url : fallbackBaseUrl);
    const apiVersion = entry.protocol === 'anthropic_messages'
      ? (typeof entry.api_version === 'string' && entry.api_version ? entry.api_version : '2023-06-01')
      : null;
    return { protocol: entry.protocol, base_url: baseUrl, auth_scheme: authScheme, api_version: apiVersion };
  });
}

interface ChannelInput {
  name?: string;
  provider_type?: string;
  base_url?: string;
  api_key?: string;
  notes?: string;
  protocols?: unknown;
  preset_id?: string;
  detected_models?: unknown;
}

function resolveChannelInput(body: ChannelInput) {
  const presetId = body.preset_id?.trim() || null;
  const preset = presetId ? getPresetById(presetId) : undefined;
  if (presetId && !preset) throw new Error('Unknown provider preset');
  if (!body.api_key) throw new Error('api_key is required');
  const name = body.name?.trim() || preset?.name || '';
  const providerType = preset?.provider_type ?? body.provider_type;
  const requestedBaseUrl = preset?.base_url ?? body.base_url;
  if (!name || !providerType || !requestedBaseUrl) {
    throw new Error('name, provider_type, and base_url are required');
  }
  if (providerType !== 'openai' && providerType !== 'openai_compatible') {
    throw new Error('provider_type must be openai or openai_compatible');
  }
  const baseUrl = normalizeBaseUrl(requestedBaseUrl);
  return {
    presetId,
    name,
    providerType,
    baseUrl,
    protocols: normalizeProtocols(preset?.protocols ?? body.protocols, baseUrl),
  };
}

function normalizeDetectedModels(input: unknown): DiscoveredProviderModel[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 500) throw new Error('detected_models must contain at most 500 items');
  const found = new Map<string, DiscoveredProviderModel>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid detected model');
    const item = raw as Record<string, unknown>;
    const id = typeof item.provider_model_id === 'string' ? item.provider_model_id.trim() : '';
    if (!id || id.length > 200) throw new Error('Invalid detected model ID');
    found.set(id, {
      id,
      displayName: typeof item.display_name === 'string' && item.display_name.trim()
        ? item.display_name.trim() : id,
      capabilities: item.capabilities,
    });
  }
  return [...found.values()];
}

/** POST /admin/api/channels/preflight — no D1 writes. */
export async function handleChannelPreflight(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'POST') return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  let body: ChannelInput;
  let resolved: ReturnType<typeof resolveChannelInput>;
  try {
    body = await request.json() as ChannelInput;
    resolved = resolveChannelInput(body);
  } catch (error) {
    return gatewayErrorResponse('invalid_request', (error as Error).message, requestId);
  }
  try {
    const models = await discoverProviderModels({
      preset_id: resolved.presetId,
      protocols: resolved.protocols,
    }, body.api_key!);
    // Attach baseline prices from the editable price library so the console
    // can prefill input/output/cache costs for each model.
    const { getModelPrices } = await import('../db/model-prices.ts');
    const baseline = await getModelPrices(env.DB, models.map((m) => m.id));
    return json({
      ok: true,
      resolved: {
        name: resolved.name,
        provider_type: resolved.providerType,
        base_url: resolved.baseUrl,
        preset_id: resolved.presetId,
        protocols: resolved.protocols,
      },
      models: models.map((model) => {
        const price = baseline.get(model.id);
        return {
          provider_model_id: model.id,
          display_name: model.displayName,
          capabilities: model.capabilities,
          baseline_price: price ? {
            input: price.input_price_micros_per_million,
            output: price.output_price_micros_per_million,
            cache: price.cache_input_price_micros_per_million,
            currency: price.currency,
          } : null,
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? 'Provider model discovery timed out' : error instanceof Error ? error.message : 'Model discovery failed';
    return json({ ok: false, error: { message } }, 502);
  }
}

/**
 * GET/POST /admin/api/channels
 */
export async function handleChannelsCollection(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const channels = await listChannels(env.DB);
    return json(channels.map(toPublicChannel));
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json() as ChannelInput;
      const { presetId, name, providerType, baseUrl, protocols } = resolveChannelInput(body);
      const detectedModels = normalizeDetectedModels(body.detected_models);

      const id = generateId();
      const { ciphertext, iv } = await encryptProviderKey(
        body.api_key!,
        env.MASTER_KEY,
        id,
        1,
      );

      await createChannel(env.DB, {
        id,
        name,
        provider_type: providerType as 'openai' | 'openai_compatible',
        base_url: baseUrl,
        api_key_ciphertext: ciphertext,
        api_key_iv: iv,
        api_key_version: 1,
        status: 'active',
        notes: body.notes ?? null,
        preset_id: presetId,
        short_code: providerShortCode(presetId, name),
      });
      await replaceChannelProtocols(env.DB, id, protocols);
      if (body.detected_models !== undefined) {
        await persistDiscoveredProviderModels(env.DB, id, detectedModels);
      }
      invalidateModelRouteCache();
      channelCircuitBreaker.reset(id);

      const channel = await getChannel(env.DB, id);
      return json(toPublicChannel(channel!), 201);
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}

/**
 * GET/PUT/DELETE /admin/api/channels/:id
 */
export async function handleChannelItem(
  request: Request,
  id: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const channel = await getChannel(env.DB, id);
    if (!channel) return gatewayErrorResponse('model_not_found', 'Channel not found', requestId);
    return json(toPublicChannel(channel));
  }

  if (request.method === 'PUT') {
    try {
      const body = (await request.json()) as {
        name?: string;
        base_url?: string;
        api_key?: string;
        status?: string;
        notes?: string;
        protocols?: unknown;
      };

      const channel = await getChannel(env.DB, id);
      if (!channel) return gatewayErrorResponse('model_not_found', 'Channel not found', requestId);
      if (channel.preset_id && (body.base_url !== undefined || body.protocols !== undefined)) {
        return gatewayErrorResponse(
          'invalid_request',
          'Preset protocol endpoints are managed by the server; create a custom channel to change them',
          requestId,
        );
      }

      const updates: Parameters<typeof updateChannel>[2] = {};

      if (body.name !== undefined) updates.name = body.name;
      if (body.status !== undefined) {
        if (!['active', 'disabled'].includes(body.status)) {
          return gatewayErrorResponse('invalid_request', 'Invalid status', requestId);
        }
        updates.status = body.status;
      }
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.base_url !== undefined) {
        try {
          updates.base_url = normalizeBaseUrl(body.base_url);
        } catch (e) {
          return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
        }
      }
      if (body.api_key !== undefined) {
        const { ciphertext, iv } = await encryptProviderKey(
          body.api_key,
          env.MASTER_KEY,
          id,
          channel.api_key_version,
        );
        updates.api_key_ciphertext = ciphertext;
        updates.api_key_iv = iv;
      }

      await updateChannel(env.DB, id, updates);
      if (body.protocols !== undefined) {
        await replaceChannelProtocols(
          env.DB,
          id,
          normalizeProtocols(body.protocols, updates.base_url ?? channel.base_url),
        );
      }
      invalidateModelRouteCache();
      channelCircuitBreaker.reset(id);
      invalidateProviderBalanceCache(id);
      const updated = await getChannel(env.DB, id);
      return json(toPublicChannel(updated!));
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  if (request.method === 'DELETE') {
    const impact = await getChannelDeleteImpact(env.DB, id);
    await softDeleteInstancesByChannel(env.DB, id);
    await softDeleteOrphanModelCards(
      env.DB,
      impact.filter((item) => item.will_delete_model).map((item) => item.model_card_id),
    );
    await softDeleteChannel(env.DB, id);
    invalidateModelRouteCache();
    channelCircuitBreaker.reset(id);
    invalidateProviderBalanceCache(id);
    return new Response(null, { status: 204 });
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}

/** GET /admin/api/channels/:id/delete-impact */
export async function handleChannelDeleteImpact(
  request: Request,
  id: string,
  env: Env,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: { message: 'Method not allowed' } }, 405);
  const channel = await getChannel(env.DB, id);
  if (!channel) return json({ error: { message: 'Channel not found' } }, 404);
  const models = await getChannelDeleteImpact(env.DB, id);
  return json({
    channel_id: id,
    channel_name: channel.name,
    instance_count: models.reduce((total, item) => total + item.channel_instances, 0),
    affected_model_count: models.length,
    orphan_model_count: models.filter((item) => item.will_delete_model).length,
    models,
  });
}

/**
 * POST /admin/api/channels/:id/test
 */
export async function handleChannelTest(
  request: Request,
  channelId: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  const channel = await getChannel(env.DB, channelId);
  if (!channel) return gatewayErrorResponse('model_not_found', 'Channel not found', requestId);

  // Decrypt provider key
  const { decryptProviderKey } = await import('../crypto/provider-key.ts');
  let providerKey: string;
  try {
    providerKey = await decryptProviderKey(
      channel.api_key_ciphertext,
      channel.api_key_iv,
      env.MASTER_KEY,
      channelId,
      channel.api_key_version,
    );
  } catch {
    return json({ ok: false, error: 'Failed to decrypt provider key' }, 500);
  }

  // Model listing is OpenAI-compatible for the presets that expose multiple
  // inference protocols (for example DeepSeek Chat + Anthropic Messages).
  const protocol = channel.protocols.find((item) => item.protocol === 'openai_chat')
    ?? channel.protocols[0];
  const testUrl = `${protocol?.base_url ?? channel.base_url}/models`;
  const start = Date.now();

  try {
    const headers = new Headers({ 'User-Agent': 'mygateway/0.1.0' });
    if (protocol?.auth_scheme === 'x_api_key') {
      headers.set('x-api-key', providerKey);
      headers.set('anthropic-version', protocol.api_version ?? '2023-06-01');
    } else {
      headers.set('Authorization', `Bearer ${providerKey}`);
    }
    const resp = await fetch(testUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    const elapsed = Date.now() - start;

    if (resp.ok) {
      channelCircuitBreaker.recordSuccess(channelId);
      return json({ ok: true, status: resp.status, elapsed_ms: elapsed });
    }
    return json({
      ok: false,
      status: resp.status,
      elapsed_ms: elapsed,
      error: `HTTP ${resp.status}`,
    });
  } catch (e) {
    const elapsed = Date.now() - start;
    return json({ ok: false, elapsed_ms: elapsed, error: (e as Error).message });
  }
}
