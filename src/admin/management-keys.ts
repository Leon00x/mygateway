import type { Env } from '../env.ts';
import { invalidateManagementKeyCache, managementKeyPrefix } from '../auth/management-key.ts';
import {
  createManagementKey,
  getManagementKey,
  listManagementKeys,
  deleteManagementKey,
  toPublicManagementKey,
  updateManagementKey,
  type ManagementPermission,
  PERMANENT_MANAGEMENT_KEY_EXPIRY,
} from '../db/management-keys.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { generateId, generateManagementKeyValue, nowSeconds, sha256Hex } from '../shared/ids.ts';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function parsePermission(value: unknown): ManagementPermission {
  if (value === undefined) return 'read';
  if (value !== 'read' && value !== 'write') throw new Error('permission must be read or write');
  return value;
}

function parseExpiry(value: unknown, fallback?: number): number {
  if (value === null) return PERMANENT_MANAGEMENT_KEY_EXPIRY;
  const expiresAt = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(expiresAt) || Number(expiresAt) <= nowSeconds()) {
    throw new Error('expires_at must be a future unix timestamp in seconds');
  }
  return Number(expiresAt);
}

export async function handleManagementKeysCollection(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    return json((await listManagementKeys(env.DB)).map(toPublicManagementKey));
  }
  if (request.method !== 'POST') {
    return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  }

  try {
    const body = await request.json() as { name?: string; permission?: unknown; expires_at?: unknown };
    const name = body.name?.trim();
    if (!name) throw new Error('name is required');
    const rawKey = generateManagementKeyValue();
    const id = generateId();
    await createManagementKey(env.DB, {
      id,
      name,
      keyPrefix: managementKeyPrefix(rawKey),
      keyHash: await sha256Hex(rawKey),
      permission: parsePermission(body.permission),
      expiresAt: parseExpiry(body.expires_at, nowSeconds() + 7 * 86_400),
    });
    invalidateManagementKeyCache();
    const created = await getManagementKey(env.DB, id);
    return json({ ...toPublicManagementKey(created!), key: rawKey }, 201);
  } catch (error) {
    return gatewayErrorResponse('invalid_request', (error as Error).message, requestId);
  }
}

export async function handleManagementKeyItem(
  request: Request,
  id: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  const current = await getManagementKey(env.DB, id);
  if (!current) return gatewayErrorResponse('model_not_found', 'Management key not found', requestId);

  if (request.method === 'DELETE') {
    await deleteManagementKey(env.DB, id);
    invalidateManagementKeyCache();
    return new Response(null, { status: 204 });
  }
  if (request.method !== 'PUT') {
    return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  }

  try {
    const body = await request.json() as {
      name?: string;
      permission?: unknown;
      status?: unknown;
      expires_at?: unknown;
    };
    if (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled') {
      throw new Error('status must be active or disabled');
    }
    await updateManagementKey(env.DB, id, {
      name: body.name === undefined ? undefined : (body.name.trim() || current.name),
      permission: body.permission === undefined ? undefined : parsePermission(body.permission),
      status: body.status as 'active' | 'disabled' | undefined,
      expiresAt: body.expires_at === undefined ? undefined : parseExpiry(body.expires_at),
    });
    invalidateManagementKeyCache();
    return json(toPublicManagementKey((await getManagementKey(env.DB, id))!));
  } catch (error) {
    return gatewayErrorResponse('invalid_request', (error as Error).message, requestId);
  }
}
