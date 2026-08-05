/**
 * Admin models API handlers.
 */

import { Env } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { generateId } from '../shared/ids.ts';
import {
  listModelCards,
  getModelCard,
  createModelCard,
  updateModelCard,
  softDeleteModelCard,
  listChannelModels,
  createChannelModel,
  reorderInstances,
  resolveIdentifier,
  createIdentifier,
  deleteIdentifier,
  ModelCardRow,
  ChannelModelRow,
} from '../db/models.ts';
import { invalidateModelRouteCache } from '../gateway/access-resolver.ts';
import { getChannel } from '../db/channels.ts';
import { getPresetById } from '../shared/provider-presets.ts';
import { markProviderModelImported } from '../db/provider-models.ts';
import { normalizeModelIdentifier, stableChannelModelAlias } from './model-discovery.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET/POST /admin/api/models
 */
export async function handleModelsCollection(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const cards = await listModelCards(env.DB);
    const result = [];
    for (const card of cards) {
      const instances = await listChannelModels(env.DB, card.id);
      result.push({ ...card, instances });
    }
    return json(result);
  }

  if (request.method === 'POST') {
    try {
      const body = (await request.json()) as {
        unified_model_id?: string;
        display_name?: string;
        channel_id?: string;
        channel_model_id?: string;
      };

      if (!body.unified_model_id || !body.display_name) {
        return gatewayErrorResponse('invalid_request', 'unified_model_id and display_name are required', requestId);
      }

      const unifiedModelId = normalizeModelIdentifier(body.unified_model_id);
      if (!unifiedModelId) {
        return gatewayErrorResponse('invalid_request', 'unified_model_id is invalid', requestId);
      }
      if (Boolean(body.channel_id) !== Boolean(body.channel_model_id)) {
        return gatewayErrorResponse('invalid_request', 'channel_id and channel_model_id must be provided together', requestId);
      }

      const channel = body.channel_id ? await getChannel(env.DB, body.channel_id) : null;
      if (body.channel_id && !channel) {
        return gatewayErrorResponse('invalid_request', 'Channel not found', requestId);
      }

      // Check identifier uniqueness
      const existing = await resolveIdentifier(env.DB, unifiedModelId);
      if (existing) {
        return gatewayErrorResponse('invalid_request', `Identifier '${unifiedModelId}' is already in use`, requestId);
      }

      const id = generateId();
      let instanceId: string | null = null;
      try {
        // D1 local has historically hung on batch(), so keep the short sequence
        // explicit and compensate on failure.
        await createModelCard(env.DB, { id, unified_model_id: unifiedModelId, display_name: body.display_name });
        await createIdentifier(env.DB, { identifier: unifiedModelId, identifier_type: 'unified', model_card_id: id, channel_model_id: null });

        if (channel && body.channel_model_id) {
          const upstreamModelId = body.channel_model_id.trim();
          if (!upstreamModelId) throw new Error('channel_model_id is invalid');
          const aliasBase = stableChannelModelAlias(channel, upstreamModelId);
          let alias = aliasBase;
          for (let suffix = 0; alias === unifiedModelId || await resolveIdentifier(env.DB, alias); suffix++) {
            alias = `${aliasBase}-direct${suffix ? `-${suffix + 1}` : ''}`;
          }
          instanceId = generateId();
          await createChannelModel(env.DB, {
            id: instanceId, model_card_id: id, channel_id: channel.id,
            channel_model_id: upstreamModelId, public_model_alias: alias,
            sort_order: 0, status: 'active',
            supports_stream_usage: getPresetById(channel.preset_id ?? '')?.supports_stream_usage ? 1 : 0,
            input_price_micros_per_million: null, output_price_micros_per_million: null,
            currency: null, plan_tokens_total: null, plan_tokens_remaining: null, plan_expires_at: null,
          });
          await createIdentifier(env.DB, {
            identifier: alias, identifier_type: 'alias', model_card_id: id, channel_model_id: instanceId,
          });
          await markProviderModelImported(env.DB, channel.id, upstreamModelId, id);
        }

        invalidateModelRouteCache();
        const card = await getModelCard(env.DB, id);
        return json({ ...card, instances: await listChannelModels(env.DB, id) }, 201);
      } catch (error) {
        await env.DB.prepare('DELETE FROM model_identifiers WHERE model_card_id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM channel_models WHERE model_card_id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM model_cards WHERE id = ?').bind(id).run();
        throw error;
      }
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}

/**
 * GET/PUT/DELETE /admin/api/models/:id
 */
export async function handleModelItem(
  request: Request,
  id: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  const card = await getModelCard(env.DB, id);
  if (!card) return gatewayErrorResponse('model_not_found', 'Model not found', requestId);

  if (request.method === 'GET') {
    const instances = await listChannelModels(env.DB, id);
    return json({ ...card, instances });
  }

  if (request.method === 'PUT') {
    try {
      const body = (await request.json()) as { display_name?: string; status?: string };
      await updateModelCard(env.DB, id, body);
      invalidateModelRouteCache();
      const updated = await getModelCard(env.DB, id);
      const instances = await listChannelModels(env.DB, id);
      return json({ ...updated, instances });
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  if (request.method === 'DELETE') {
    // Soft-delete card + instances + identifiers, and FREE the unified_model_id
    // (rename to a deleted:<ts> placeholder) so the same ID can be recreated.
    // usage_minutes rows FK to model_cards, so we keep the row around.
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('DELETE FROM model_identifiers WHERE model_card_id = ?').bind(id).run();
    await env.DB.prepare('UPDATE model_cards SET deleted_at = ?, updated_at = ?, unified_model_id = ? WHERE id = ?')
      .bind(now, now, `deleted:${id}:${now}`, id)
      .run();
    await env.DB.prepare('UPDATE channel_models SET deleted_at = ?, updated_at = ? WHERE model_card_id = ?')
      .bind(now, now, id)
      .run();
    await env.DB.prepare(
      'UPDATE channel_provider_models SET imported_model_card_id = NULL, updated_at = ? WHERE imported_model_card_id = ?',
    ).bind(now, id).run();
    invalidateModelRouteCache();
    return new Response(null, { status: 204 });
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}

/**
 * POST /admin/api/models/:id/instances
 */
export async function handleModelInstances(
  request: Request,
  modelId: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  }

  const card = await getModelCard(env.DB, modelId);
  if (!card) return gatewayErrorResponse('model_not_found', 'Model not found', requestId);

  try {
    const body = (await request.json()) as {
      channel_id?: string;
      channel_model_id?: string;
      public_model_alias?: string;
      sort_order?: number;
      supports_stream_usage?: boolean;
      input_price_micros_per_million?: number | null;
      output_price_micros_per_million?: number | null;
    };

    if (!body.channel_id || !body.channel_model_id || !body.public_model_alias) {
      return gatewayErrorResponse('invalid_request', 'channel_id, channel_model_id, and public_model_alias are required', requestId);
    }

    // Check alias uniqueness
    const existingAlias = await resolveIdentifier(env.DB, body.public_model_alias);
    if (existingAlias) {
      return gatewayErrorResponse('invalid_request', `Alias '${body.public_model_alias}' is already in use`, requestId);
    }

    const instanceId = generateId();
    const sortOrder = body.sort_order ?? (await listChannelModels(env.DB, modelId)).length;

    // Create instance + alias identifier (sequential)
    await createChannelModel(env.DB, {
      id: instanceId,
      model_card_id: modelId,
      channel_id: body.channel_id,
      channel_model_id: body.channel_model_id,
      public_model_alias: body.public_model_alias,
      sort_order: sortOrder,
      status: 'active',
      supports_stream_usage: body.supports_stream_usage ? 1 : 0,
      input_price_micros_per_million: parseOptionalPrice(body.input_price_micros_per_million),
      output_price_micros_per_million: parseOptionalPrice(body.output_price_micros_per_million),
      currency: 'USD',
      plan_tokens_total: null,
      plan_tokens_remaining: null,
      plan_expires_at: null,
    });
    await createIdentifier(env.DB, { identifier: body.public_model_alias, identifier_type: 'alias', model_card_id: modelId, channel_model_id: instanceId });
    invalidateModelRouteCache();

    const instances = await listChannelModels(env.DB, modelId);
    return json({ ...card, instances }, 201);
  } catch (e) {
    return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
  }
}

/**
 * PUT /admin/api/models/:id/instances/:instanceId — update pricing / stream usage.
 */
export async function handleModelInstanceItem(
  request: Request,
  modelId: string,
  instanceId: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'PUT') {
    return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  }
  const card = await getModelCard(env.DB, modelId);
  if (!card) return gatewayErrorResponse('model_not_found', 'Model not found', requestId);

  const instance = (await listChannelModels(env.DB, modelId)).find((item) => item.id === instanceId);
  if (!instance) return gatewayErrorResponse('model_not_found', 'Instance not found', requestId);

  try {
    const body = (await request.json()) as {
      input_price_micros_per_million?: number | null;
      output_price_micros_per_million?: number | null;
      supports_stream_usage?: boolean;
    };
    const now = Math.floor(Date.now() / 1000);
    const fields: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];
    if (body.input_price_micros_per_million !== undefined) {
      fields.push('input_price_micros_per_million = ?');
      values.push(parseOptionalPrice(body.input_price_micros_per_million));
    }
    if (body.output_price_micros_per_million !== undefined) {
      fields.push('output_price_micros_per_million = ?');
      values.push(parseOptionalPrice(body.output_price_micros_per_million));
    }
    if (body.supports_stream_usage !== undefined) {
      fields.push('supports_stream_usage = ?');
      values.push(body.supports_stream_usage ? 1 : 0);
    }
    values.push(instanceId);
    await env.DB.prepare(`UPDATE channel_models SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

    const instances = await listChannelModels(env.DB, modelId);
    return json({ ...card, instances });
  } catch (e) {
    return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
  }
}

function parseOptionalPrice(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('price must be a non-negative number (micros per million tokens)');
  }
  return Math.round(parsed);
}
export async function handleReorderInstances(
  request: Request,
  modelId: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'PUT') {
    return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  }

  try {
    const body = (await request.json()) as { instance_ids?: string[] };
    if (!Array.isArray(body.instance_ids)) {
      return gatewayErrorResponse('invalid_request', 'instance_ids array is required', requestId);
    }

    await reorderInstances(env.DB, modelId, body.instance_ids);
    invalidateModelRouteCache();
    const card = await getModelCard(env.DB, modelId);
    const instances = await listChannelModels(env.DB, modelId);
    return json({ ...card, instances });
  } catch (e) {
    return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
  }
}
