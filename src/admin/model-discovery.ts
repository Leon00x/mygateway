import type { Env } from '../env.ts';
import { decryptProviderKey } from '../crypto/provider-key.ts';
import { getChannel, type ChannelWithProtocols } from '../db/channels.ts';
import {
  addManualProviderModel,
  deleteProviderModel,
  getDiscoveryState,
  getProviderModel,
  listProviderModels,
  markProviderModelImported,
  saveDiscoveryError,
  syncDiscoveredProviderModels,
  type DiscoveredProviderModel,
} from '../db/provider-models.ts';
import {
  createChannelModel,
  createIdentifier,
  createModelCard,
  getChannelModelForCardChannel,
  getModelCard,
  resolveIdentifier,
} from '../db/models.ts';
import { generateId } from '../shared/ids.ts';
import {
  getPresetById,
  providerModelDiscovery,
  providerShortCode,
  PROVIDER_PRESETS,
} from '../shared/provider-presets.ts';
import { invalidateModelRouteCache } from '../gateway/access-resolver.ts';
import type { ChannelProtocol } from '../gateway/protocols.ts';

const DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MODELS = 500;
const MAX_PAGES = 5;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export function normalizeModelIdentifier(input: string): string {
  return input.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._:/-]+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);
}

function displayNameFor(id: string): string {
  return id.replace(/^models\//, '').replace(/[-_/]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

type ProviderDiscoveryTarget = Pick<ChannelWithProtocols, 'preset_id' | 'protocols'>;

function inferPresetId(channel: ProviderDiscoveryTarget): string | null {
  if (channel.preset_id) return channel.preset_id;
  const bases = new Set(channel.protocols.map((protocol) => protocol.base_url.replace(/\/+$/, '')));
  return PROVIDER_PRESETS.find((preset) => preset.protocols.some(
    (protocol) => bases.has(protocol.base_url.replace(/\/+$/, '')),
  ))?.id ?? null;
}

function discoveryProtocol(channel: ProviderDiscoveryTarget, presetId: string | null): ChannelProtocol | undefined {
  const adapter = providerModelDiscovery(presetId);
  return channel.protocols.find((protocol) => protocol.protocol === adapter.protocol) ?? channel.protocols[0];
}

async function readResponseText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error('Model list response is too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Model list response is too large');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(output);
}

export function parseProviderModelList(payload: unknown): {
  models: DiscoveredProviderModel[];
  hasMore: boolean;
  lastId?: string;
  nextPageToken?: string;
} {
  if (!payload || typeof payload !== 'object') throw new Error('Provider returned an invalid model list');
  const record = payload as Record<string, unknown>;
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(record.data) ? record.data
      : Array.isArray(record.models) ? record.models : null;
  if (!raw) throw new Error('Provider model list has an unsupported response shape');
  const seen = new Set<string>();
  const models: DiscoveredProviderModel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const model = item as Record<string, unknown>;
    const rawId = typeof model.id === 'string' ? model.id
      : typeof model.name === 'string' ? model.name.replace(/^models\//, '') : '';
    const id = rawId.trim();
    if (!id || id.length > 200 || seen.has(id)) continue;
    const capabilities = model.capabilities ?? model.supportedGenerationMethods;
    if (capabilities && typeof capabilities === 'object'
      && 'completion_chat' in (capabilities as Record<string, unknown>)
      && (capabilities as Record<string, unknown>).completion_chat === false) continue;
    seen.add(id);
    models.push({
      id,
      displayName: typeof model.display_name === 'string' ? model.display_name
        : typeof model.displayName === 'string' ? model.displayName : displayNameFor(id),
      capabilities,
    });
    if (models.length >= MAX_MODELS) break;
  }
  return {
    models,
    hasMore: record.has_more === true || typeof record.nextPageToken === 'string',
    lastId: typeof record.last_id === 'string' ? record.last_id : undefined,
    nextPageToken: typeof record.nextPageToken === 'string' ? record.nextPageToken : undefined,
  };
}

/** Discover models without persisting credentials or channel state. */
export async function discoverProviderModels(
  channel: ProviderDiscoveryTarget,
  providerKey: string,
): Promise<DiscoveredProviderModel[]> {
  const presetId = inferPresetId(channel);
  const adapter = providerModelDiscovery(presetId);
  const protocol = discoveryProtocol(channel, presetId);
  if (!protocol) throw new Error('Channel has no protocol endpoint for model discovery');
  const base = (adapter.base_url ?? protocol.base_url).replace(/\/+$/, '');
  const found = new Map<string, DiscoveredProviderModel>();
  let afterId: string | undefined;
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES && found.size < MAX_MODELS; page++) {
    const url = new URL(`${base}${adapter.path}`);
    if (adapter.pagination === 'anthropic_cursor') {
      url.searchParams.set('limit', '1000');
      if (afterId) url.searchParams.set('after_id', afterId);
    } else if (adapter.pagination === 'page_token' && pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    const headers = new Headers({ 'Accept': 'application/json', 'User-Agent': 'mygateway/0.1.0' });
    if (protocol.auth_scheme === 'x_api_key') {
      headers.set('x-api-key', providerKey);
      headers.set('anthropic-version', protocol.api_version ?? '2023-06-01');
    } else {
      headers.set('Authorization', `Bearer ${providerKey}`);
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Provider model discovery returned HTTP ${response.status}`);
    let payload: unknown;
    try { payload = JSON.parse(await readResponseText(response)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error('Provider model list is not valid JSON');
      throw error;
    }
    const parsed = parseProviderModelList(payload);
    for (const model of parsed.models) found.set(model.id, model);
    if (!parsed.hasMore || (!parsed.lastId && !parsed.nextPageToken)) break;
    afterId = parsed.lastId;
    pageToken = parsed.nextPageToken;
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function modelHash(models: DiscoveredProviderModel[]): Promise<string> {
  const input = new TextEncoder().encode(models.map((model) => model.id).sort().join('\n'));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/** Persist a previously completed preflight result after channel creation. */
export async function persistDiscoveredProviderModels(
  db: D1Database,
  channelId: string,
  models: DiscoveredProviderModel[],
): Promise<void> {
  await syncDiscoveredProviderModels(db, channelId, models, await modelHash(models));
}

function serializeInventory(models: Awaited<ReturnType<typeof listProviderModels>>) {
  return models.map((model) => ({
    ...model,
    capabilities: model.capabilities_json ? JSON.parse(model.capabilities_json) : null,
    capabilities_json: undefined,
  }));
}

export async function handleChannelProviderModels(
  request: Request,
  channelId: string,
  env: Env,
): Promise<Response> {
  const channel = await getChannel(env.DB, channelId);
  if (!channel) return json({ error: { message: 'Channel not found' } }, 404);
  if (request.method === 'GET') {
    return json({
      models: serializeInventory(await listProviderModels(env.DB, channelId)),
      discovery: await getDiscoveryState(env.DB, channelId),
    });
  }
  if (request.method === 'POST') {
    const body = await request.json() as { model_id?: string; display_name?: string };
    const modelId = body.model_id?.trim() ?? '';
    if (!modelId || modelId.length > 200) return json({ error: { message: 'Valid model_id is required' } }, 400);
    await addManualProviderModel(env.DB, channelId, modelId, body.display_name?.trim() || displayNameFor(modelId));
    return json({ models: serializeInventory(await listProviderModels(env.DB, channelId)) }, 201);
  }
  if (request.method === 'DELETE') {
    const modelId = new URL(request.url).searchParams.get('model_id') ?? '';
    if (!modelId) return json({ error: { message: 'model_id is required' } }, 400);
    await deleteProviderModel(env.DB, channelId, modelId);
    return new Response(null, { status: 204 });
  }
  return json({ error: { message: 'Method not allowed' } }, 405);
}

export async function handleChannelModelRefresh(channelId: string, env: Env): Promise<Response> {
  const channel = await getChannel(env.DB, channelId);
  if (!channel) return json({ error: { message: 'Channel not found' } }, 404);
  try {
    const key = await decryptProviderKey(
      channel.api_key_ciphertext, channel.api_key_iv, env.MASTER_KEY, channelId, channel.api_key_version,
    );
    const models = await discoverProviderModels(channel, key);
    await persistDiscoveredProviderModels(env.DB, channelId, models);
    return json({
      models: serializeInventory(await listProviderModels(env.DB, channelId)),
      discovery: await getDiscoveryState(env.DB, channelId),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? 'Provider model discovery timed out' : error instanceof Error ? error.message : 'Model discovery failed';
    await saveDiscoveryError(env.DB, channelId, message);
    return json({ error: { message }, discovery: await getDiscoveryState(env.DB, channelId) }, 502);
  }
}

export function stableChannelModelAlias(channel: ChannelWithProtocols, providerModelId: string): string {
  const prefix = channel.short_code || providerShortCode(inferPresetId(channel), channel.name);
  const token = channel.id.replace(/-/g, '').slice(0, 6).toLowerCase();
  return normalizeModelIdentifier(`${prefix}-${token}-${providerModelId}`);
}

export async function handleChannelModelImport(
  request: Request,
  channelId: string,
  env: Env,
): Promise<Response> {
  const channel = await getChannel(env.DB, channelId);
  if (!channel) return json({ error: { message: 'Channel not found' } }, 404);
  const body = await request.json() as { models?: Array<{ provider_model_id?: string; unified_model_id?: string }> };
  if (!Array.isArray(body.models) || body.models.length === 0 || body.models.length > 100) {
    return json({ error: { message: 'models must contain 1 to 100 items' } }, 400);
  }
  const results: Array<Record<string, unknown>> = [];
  for (const item of body.models) {
    const providerModelId = item.provider_model_id?.trim() ?? '';
    const inventory = providerModelId ? await getProviderModel(env.DB, channelId, providerModelId) : null;
    if (!inventory) {
      results.push({ provider_model_id: providerModelId, ok: false, error: 'Model is not in channel inventory' });
      continue;
    }
    let unifiedId = normalizeModelIdentifier(item.unified_model_id || providerModelId);
    if (!unifiedId) {
      results.push({ provider_model_id: providerModelId, ok: false, error: 'Invalid unified model ID' });
      continue;
    }
    let identifier = await resolveIdentifier(env.DB, unifiedId);
    if (identifier?.identifier_type === 'alias') {
      unifiedId = stableChannelModelAlias(channel, providerModelId);
      identifier = await resolveIdentifier(env.DB, unifiedId);
    }
    let modelCardId: string;
    let created = false;
    if (identifier?.identifier_type === 'unified') {
      modelCardId = identifier.model_card_id;
    } else if (!identifier) {
      modelCardId = generateId();
      await createModelCard(env.DB, {
        id: modelCardId, unified_model_id: unifiedId, display_name: inventory.display_name,
      });
      await createIdentifier(env.DB, {
        identifier: unifiedId, identifier_type: 'unified', model_card_id: modelCardId, channel_model_id: null,
      });
      created = true;
    } else {
      results.push({ provider_model_id: providerModelId, ok: false, error: 'Unified model ID is unavailable' });
      continue;
    }
    const existingInstance = await getChannelModelForCardChannel(env.DB, modelCardId, channelId);
    if (existingInstance) {
      if (existingInstance.channel_model_id !== providerModelId) {
        results.push({ provider_model_id: providerModelId, ok: false, error: 'This channel is already bound to the unified model' });
        continue;
      }
      await markProviderModelImported(env.DB, channelId, providerModelId, modelCardId);
      results.push({ provider_model_id: providerModelId, ok: true, created, unified_model_id: unifiedId, alias: existingInstance.public_model_alias });
      continue;
    }
    const aliasBase = stableChannelModelAlias(channel, providerModelId);
    let alias = aliasBase;
    for (let suffix = 0; alias === unifiedId || await resolveIdentifier(env.DB, alias); suffix++) {
      alias = `${aliasBase}-direct${suffix ? `-${suffix + 1}` : ''}`;
    }
    const instanceId = generateId();
    const existingCard = await getModelCard(env.DB, modelCardId);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM channel_models WHERE model_card_id = ? AND deleted_at IS NULL',
    ).bind(modelCardId).first<{ count: number }>();
    try {
      await createChannelModel(env.DB, {
        id: instanceId, model_card_id: modelCardId, channel_id: channelId,
        channel_model_id: providerModelId, public_model_alias: alias,
        sort_order: count?.count ?? 0, status: 'active',
        supports_stream_usage: getPresetById(inferPresetId(channel) ?? '')?.supports_stream_usage ? 1 : 0,
        input_price_micros_per_million: null, output_price_micros_per_million: null,
        currency: null, plan_tokens_total: null, plan_tokens_remaining: null, plan_expires_at: null,
      });
      await createIdentifier(env.DB, {
        identifier: alias, identifier_type: 'alias', model_card_id: existingCard?.id ?? modelCardId, channel_model_id: instanceId,
      });
      await markProviderModelImported(env.DB, channelId, providerModelId, modelCardId);
      results.push({ provider_model_id: providerModelId, ok: true, created, unified_model_id: unifiedId, alias });
    } catch (error) {
      await env.DB.prepare('DELETE FROM model_identifiers WHERE identifier = ?').bind(alias).run();
      await env.DB.prepare('DELETE FROM channel_models WHERE id = ?').bind(instanceId).run();
      if (created) {
        await env.DB.prepare('DELETE FROM model_identifiers WHERE model_card_id = ?').bind(modelCardId).run();
        await env.DB.prepare('DELETE FROM model_cards WHERE id = ?').bind(modelCardId).run();
      }
      results.push({
        provider_model_id: providerModelId, ok: false,
        error: error instanceof Error ? error.message : 'Import failed',
      });
    }
  }
  invalidateModelRouteCache();
  return json({ results, models: serializeInventory(await listProviderModels(env.DB, channelId)) });
}
