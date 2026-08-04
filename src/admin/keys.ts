/**
 * Admin gateway keys API handlers.
 */

import { Env } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { generateId, generateGatewayKeyValue, sha256Hex } from '../shared/ids.ts';
import { hashGatewayKey, gatewayKeyPrefix } from '../auth/gateway-key.ts';
import {
  listGatewayKeys,
  createGatewayKey,
  findActiveKeyByHash,
  updateGatewayKeyStatus,
  revokeGatewayKey,
  deleteGatewayKey,
  toPublicKey,
} from '../db/keys.ts';
import { invalidateGatewayKeyCache } from '../gateway/access-resolver.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET/POST /admin/api/keys
 */
export async function handleKeysCollection(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const keys = await listGatewayKeys(env.DB);
    return json(keys.map(toPublicKey));
  }

  if (request.method === 'POST') {
    try {
      const body = (await request.json()) as { name?: string };
      if (!body.name) {
        return gatewayErrorResponse('invalid_request', 'name is required', requestId);
      }

      const rawKey = generateGatewayKeyValue();
      const keyHash = await hashGatewayKey(rawKey);
      const prefix = gatewayKeyPrefix(rawKey);
      const id = generateId();

      await createGatewayKey(env.DB, { id, name: body.name, key_prefix: prefix, key_hash: keyHash });
      invalidateGatewayKeyCache();

      // Return the raw key ONCE
      const key = await listGatewayKeys(env.DB);
      const created = key.find((k) => k.id === id);
      return json({ ...toPublicKey(created!), key: rawKey }, 201);
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}

/**
 * PUT/DELETE /admin/api/keys/:id
 */
export async function handleKeyItem(
  request: Request,
  id: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'PUT') {
    try {
      const body = (await request.json()) as { name?: string; status?: string };
      if (body.status) {
        if (!['active', 'disabled'].includes(body.status)) {
          return gatewayErrorResponse('invalid_request', 'Invalid status', requestId);
        }
        await updateGatewayKeyStatus(env.DB, id, body.status as 'active' | 'disabled');
        invalidateGatewayKeyCache();
      }
      const keys = await listGatewayKeys(env.DB);
      const key = keys.find((k) => k.id === id);
      if (!key) return gatewayErrorResponse('model_not_found', 'Key not found', requestId);
      return json(toPublicKey(key));
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  if (request.method === 'DELETE') {
    await deleteGatewayKey(env.DB, id);
    invalidateGatewayKeyCache();
    return new Response(null, { status: 204 });
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}

/**
 * POST /admin/api/keys/:id/regenerate
 */
export async function handleKeyRegenerate(
  request: Request,
  id: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  try {
    // Revoke old key
    await revokeGatewayKey(env.DB, id);

    // Create new key with same name
    const keys = await listGatewayKeys(env.DB);
    const old = keys.find((k) => k.id === id);
    const name = old?.name ?? 'regenerated';

    const rawKey = generateGatewayKeyValue();
    const keyHash = await hashGatewayKey(rawKey);
    const prefix = gatewayKeyPrefix(rawKey);
    const newId = generateId();

    await createGatewayKey(env.DB, { id: newId, name, key_prefix: prefix, key_hash: keyHash });
    invalidateGatewayKeyCache();

    return json({ id: newId, name, key_prefix: prefix, key: rawKey, status: 'active' }, 201);
  } catch (e) {
    return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
  }
}
