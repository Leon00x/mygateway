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
  updateGatewayKeyLimits,
  revokeGatewayKey,
  deleteGatewayKey,
  cleanupExpiredTemporaryGatewayKeys,
  getGatewayKey,
  serializeModelAllowlist,
  toPublicKey,
} from '../db/keys.ts';
import { invalidateGatewayKeyCache } from '../gateway/access-resolver.ts';
import { isLimitPeriod, type LimitPeriod } from '../shared/key-limits.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseOptionalInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Limit must be a non-negative integer');
  }
  return parsed;
}

function parseLimitPeriod(value: unknown): LimitPeriod {
  if (!isLimitPeriod(value)) {
    throw new Error('limit_period must be one of: day, week, month, year');
  }
  return value;
}

function resolveLimitValue(current: unknown, legacyDaily: unknown, field: string): number | null {
  if (current !== undefined && legacyDaily !== undefined) {
    const parsed = parseOptionalInt(current);
    if (parsed !== parseOptionalInt(legacyDaily)) {
      throw new Error(`${field} conflicts with its deprecated daily field`);
    }
    return parsed;
  }
  return parseOptionalInt(current !== undefined ? current : legacyDaily);
}

function parseOptionalExpiry(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('expires_at must be a unix timestamp in seconds');
  }
  if (parsed <= Math.floor(Date.now() / 1000)) {
    throw new Error('expires_at must be in the future');
  }
  return parsed;
}

function parseModelAllowlistInput(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  throw new Error('model_allowlist must be an array of model ids');
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
      await cleanupExpiredTemporaryGatewayKeys(env.DB);
      const body = (await request.json()) as {
        name?: string;
        rpm_limit?: unknown;
        request_limit?: unknown;
        token_limit?: unknown;
        limit_period?: unknown;
        /** Deprecated aliases retained for API compatibility. */
        daily_request_limit?: unknown;
        daily_token_limit?: unknown;
        expires_at?: unknown;
        model_allowlist?: unknown;
        temporary?: unknown;
      };
      if (!body.name) {
        return gatewayErrorResponse('invalid_request', 'name is required', requestId);
      }

      const rawKey = generateGatewayKeyValue();
      const keyHash = await hashGatewayKey(rawKey);
      const prefix = gatewayKeyPrefix(rawKey);
      const id = generateId();
      const isTemporary = body.temporary === true;
      const limitPeriod = body.limit_period === undefined ? 'day' : parseLimitPeriod(body.limit_period);

      await createGatewayKey(env.DB, {
        id,
        name: body.name,
        key_prefix: prefix,
        key_hash: keyHash,
        rpm_limit: isTemporary ? null : parseOptionalInt(body.rpm_limit),
        request_limit: isTemporary ? null : resolveLimitValue(body.request_limit, body.daily_request_limit, 'request_limit'),
        token_limit: isTemporary ? null : resolveLimitValue(body.token_limit, body.daily_token_limit, 'token_limit'),
        limit_period: isTemporary ? 'day' : limitPeriod,
        expires_at: isTemporary ? Math.floor(Date.now() / 1000) + 3600 : parseOptionalExpiry(body.expires_at),
        model_allowlist: isTemporary ? null : serializeModelAllowlist(parseModelAllowlistInput(body.model_allowlist)),
        is_temporary: isTemporary,
      });
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
      const current = await getGatewayKey(env.DB, id);
      if (!current) return gatewayErrorResponse('model_not_found', 'Key not found', requestId);
      const body = (await request.json()) as {
        name?: string;
        status?: string;
        rpm_limit?: unknown;
        request_limit?: unknown;
        token_limit?: unknown;
        limit_period?: unknown;
        daily_request_limit?: unknown;
        daily_token_limit?: unknown;
        expires_at?: unknown;
        model_allowlist?: unknown;
      };
      if (current.is_temporary === 1 && [
        body.rpm_limit,
        body.request_limit,
        body.token_limit,
        body.limit_period,
        body.daily_request_limit,
        body.daily_token_limit,
        body.expires_at,
        body.model_allowlist,
      ].some((value) => value !== undefined)) {
        return gatewayErrorResponse(
          'invalid_request',
          'Temporary key expiration and access limits are fixed and cannot be renewed',
          requestId,
        );
      }

      const limitUpdates: Parameters<typeof updateGatewayKeyLimits>[2] = {};
      if (body.rpm_limit !== undefined) limitUpdates.rpm_limit = parseOptionalInt(body.rpm_limit);
      if (body.request_limit !== undefined || body.daily_request_limit !== undefined) {
        limitUpdates.request_limit = resolveLimitValue(body.request_limit, body.daily_request_limit, 'request_limit');
      }
      if (body.token_limit !== undefined || body.daily_token_limit !== undefined) {
        limitUpdates.token_limit = resolveLimitValue(body.token_limit, body.daily_token_limit, 'token_limit');
      }
      if (body.limit_period !== undefined) {
        limitUpdates.limit_period = parseLimitPeriod(body.limit_period);
      } else if (body.daily_request_limit !== undefined || body.daily_token_limit !== undefined) {
        // A legacy caller explicitly setting a daily field keeps daily semantics.
        limitUpdates.limit_period = 'day';
      }
      if (body.expires_at !== undefined) limitUpdates.expires_at = parseOptionalExpiry(body.expires_at);
      if (body.model_allowlist !== undefined) {
        limitUpdates.model_allowlist = serializeModelAllowlist(parseModelAllowlistInput(body.model_allowlist));
      }
      if (Object.keys(limitUpdates).length > 0) {
        await updateGatewayKeyLimits(env.DB, id, limitUpdates);
      }

      if (body.name !== undefined) {
        await env.DB.prepare('UPDATE gateway_api_keys SET name = ?, updated_at = ? WHERE id = ?')
          .bind(body.name.trim() || 'unnamed', Math.floor(Date.now() / 1000), id)
          .run();
      }
      if (body.status !== undefined) {
        if (!['active', 'disabled'].includes(body.status)) {
          return gatewayErrorResponse('invalid_request', 'Invalid status', requestId);
        }
        await updateGatewayKeyStatus(env.DB, id, body.status as 'active' | 'disabled');
      }
      if (body.name !== undefined || Object.keys(limitUpdates).length > 0 || body.status !== undefined) {
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
    await cleanupExpiredTemporaryGatewayKeys(env.DB);
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
    const current = await getGatewayKey(env.DB, id);
    if (!current) return gatewayErrorResponse('model_not_found', 'Key not found', requestId);
    if (current.is_temporary === 1) {
      return gatewayErrorResponse('invalid_request', 'Temporary keys cannot be regenerated or renewed', requestId);
    }
    // Revoke old key
    await revokeGatewayKey(env.DB, id);

    const rawKey = generateGatewayKeyValue();
    const keyHash = await hashGatewayKey(rawKey);
    const prefix = gatewayKeyPrefix(rawKey);
    const newId = generateId();

    await createGatewayKey(env.DB, {
      id: newId,
      name: current.name,
      key_prefix: prefix,
      key_hash: keyHash,
      rpm_limit: current.rpm_limit,
      request_limit: current.request_limit === undefined ? current.daily_request_limit : current.request_limit,
      token_limit: current.token_limit === undefined ? current.daily_token_limit : current.token_limit,
      limit_period: current.limit_period ?? 'day',
      expires_at: current.expires_at,
      model_allowlist: current.model_allowlist,
    });
    invalidateGatewayKeyCache();

    const created = await getGatewayKey(env.DB, newId);
    return json({ ...toPublicKey(created!), key: rawKey }, 201);
  } catch (e) {
    return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
  }
}
