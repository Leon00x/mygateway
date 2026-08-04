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
      };

      if (!body.unified_model_id || !body.display_name) {
        return gatewayErrorResponse('invalid_request', 'unified_model_id and display_name are required', requestId);
      }

      // Check identifier uniqueness
      const existing = await resolveIdentifier(env.DB, body.unified_model_id);
      if (existing) {
        return gatewayErrorResponse('invalid_request', `Identifier '${body.unified_model_id}' is already in use`, requestId);
      }

      const id = generateId();

      // Create model card + identifier (sequential, not batch — D1 batch can hang in local dev)
      await createModelCard(env.DB, { id, unified_model_id: body.unified_model_id, display_name: body.display_name });
      await createIdentifier(env.DB, { identifier: body.unified_model_id, identifier_type: 'unified', model_card_id: id, channel_model_id: null });
      invalidateModelRouteCache();

      const card = await getModelCard(env.DB, id);
      return json({ ...card, instances: [] }, 201);
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
      input_price_micros_per_million: null,
      output_price_micros_per_million: null,
      currency: null,
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
 * PUT /admin/api/models/:id/instances/reorder
 */
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
