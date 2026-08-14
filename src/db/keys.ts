/**
 * Gateway API Key database operations, including virtual-key limits.
 */

import type { LimitPeriod } from '../shared/key-limits.ts';

export interface GatewayKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  status: 'active' | 'disabled';
  rpm_limit: number | null;
  daily_request_limit: number | null;
  daily_token_limit: number | null;
  request_limit: number | null;
  token_limit: number | null;
  limit_period: LimitPeriod;
  expires_at: number | null;
  model_allowlist: string | null;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
  is_temporary: 0 | 1;
}

export interface GatewayKeyLimits {
  rpmLimit: number | null;
  requestLimit: number | null;
  tokenLimit: number | null;
  limitPeriod: LimitPeriod;
  expiresAt: number | null;
  modelAllowlist: string[];
}

/** Key as returned to admin API (no hash). */
export interface GatewayKeyPublic {
  id: string;
  name: string;
  key_prefix: string;
  status: 'active' | 'disabled';
  rpm_limit: number | null;
  request_limit: number | null;
  token_limit: number | null;
  limit_period: LimitPeriod;
  /** @deprecated Use request_limit with limit_period='day'. */
  daily_request_limit: number | null;
  /** @deprecated Use token_limit with limit_period='day'. */
  daily_token_limit: number | null;
  expires_at: number | null;
  model_allowlist: string[];
  created_at: number;
  updated_at: number;
  is_temporary: boolean;
}

export function toPublicKey(row: GatewayKeyRow): GatewayKeyPublic {
  const requestLimit = row.request_limit === undefined ? row.daily_request_limit ?? null : row.request_limit;
  const tokenLimit = row.token_limit === undefined ? row.daily_token_limit ?? null : row.token_limit;
  const limitPeriod = row.limit_period ?? 'day';
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    status: row.status,
    rpm_limit: row.rpm_limit,
    request_limit: requestLimit,
    token_limit: tokenLimit,
    limit_period: limitPeriod,
    daily_request_limit: limitPeriod === 'day' ? requestLimit : null,
    daily_token_limit: limitPeriod === 'day' ? tokenLimit : null,
    expires_at: row.expires_at,
    model_allowlist: parseModelAllowlist(row.model_allowlist),
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_temporary: row.is_temporary === 1,
  };
}

/** Parse a stored allowlist (JSON array of unified model ids). */
export function parseModelAllowlist(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

/** Serialize an allowlist for storage (null when empty). */
export function serializeModelAllowlist(models: string[] | undefined): string | null {
  if (!models || models.length === 0) return null;
  return JSON.stringify([...new Set(models.map((item) => item.trim()).filter(Boolean))]);
}

export async function listGatewayKeys(db: D1Database): Promise<GatewayKeyRow[]> {
  const result = await db
    .prepare(`SELECT * FROM gateway_api_keys
      WHERE is_temporary = 0 OR expires_at IS NULL OR expires_at > unixepoch()
      ORDER BY created_at DESC`)
    .all<GatewayKeyRow>();
  return result.results;
}

export async function createGatewayKey(
  db: D1Database,
  key: {
    id: string;
    name: string;
    key_prefix: string;
    key_hash: string;
    rpm_limit?: number | null;
    request_limit?: number | null;
    token_limit?: number | null;
    limit_period?: LimitPeriod;
    expires_at?: number | null;
    model_allowlist?: string | null;
    is_temporary?: boolean;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO gateway_api_keys
        (id, name, key_prefix, key_hash, rpm_limit, request_limit, token_limit, limit_period,
         expires_at, model_allowlist, is_temporary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      key.id,
      key.name,
      key.key_prefix,
      key.key_hash,
      key.rpm_limit ?? null,
      key.request_limit ?? null,
      key.token_limit ?? null,
      key.limit_period ?? 'day',
      key.expires_at ?? null,
      key.model_allowlist ?? null,
      key.is_temporary ? 1 : 0,
    )
    .run();
}

export async function getGatewayKey(db: D1Database, id: string): Promise<GatewayKeyRow | null> {
  return db.prepare('SELECT * FROM gateway_api_keys WHERE id = ? LIMIT 1').bind(id).first<GatewayKeyRow>();
}

export async function cleanupExpiredTemporaryGatewayKeys(db: D1Database): Promise<number> {
  const result = await db.prepare(
    'DELETE FROM gateway_api_keys WHERE is_temporary = 1 AND expires_at <= unixepoch()',
  ).run();
  return result.meta.changes ?? 0;
}

/**
 * Lookup an active key by its hash. Used for gateway auth.
 */
export async function findActiveKeyByHash(
  db: D1Database,
  keyHash: string,
): Promise<Pick<GatewayKeyRow, 'id' | 'name'> | null> {
  return db
    .prepare(
      'SELECT id, name FROM gateway_api_keys WHERE key_hash = ? AND status = ? AND revoked_at IS NULL LIMIT 1',
    )
    .bind(keyHash, 'active')
    .first();
}

export async function updateGatewayKeyStatus(
  db: D1Database,
  id: string,
  status: 'active' | 'disabled',
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('UPDATE gateway_api_keys SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now, id)
    .run();
}

export async function updateGatewayKeyLimits(
  db: D1Database,
  id: string,
  limits: {
    rpm_limit?: number | null;
    request_limit?: number | null;
    token_limit?: number | null;
    limit_period?: LimitPeriod;
    expires_at?: number | null;
    model_allowlist?: string | null;
  },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (limits.rpm_limit !== undefined) {
    fields.push('rpm_limit = ?');
    values.push(limits.rpm_limit);
  }
  if (limits.request_limit !== undefined) {
    fields.push('request_limit = ?');
    values.push(limits.request_limit);
  }
  if (limits.token_limit !== undefined) {
    fields.push('token_limit = ?');
    values.push(limits.token_limit);
  }
  if (limits.limit_period !== undefined) {
    fields.push('limit_period = ?');
    values.push(limits.limit_period);
  }
  if (limits.expires_at !== undefined) {
    fields.push('expires_at = ?');
    values.push(limits.expires_at);
  }
  if (limits.model_allowlist !== undefined) {
    fields.push('model_allowlist = ?');
    values.push(limits.model_allowlist);
  }

  values.push(id);
  await db
    .prepare(`UPDATE gateway_api_keys SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function revokeGatewayKey(db: D1Database, id: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('UPDATE gateway_api_keys SET revoked_at = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(now, 'disabled', now, id)
    .run();
}

/**
 * Hard-delete a gateway key. Used for admin DELETE.
 */
export async function deleteGatewayKey(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM gateway_api_keys WHERE id = ?').bind(id).run();
}
