/**
 * Gateway API Key database operations, including virtual-key limits.
 */

export interface GatewayKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  status: 'active' | 'disabled';
  rpm_limit: number | null;
  daily_request_limit: number | null;
  daily_token_limit: number | null;
  expires_at: number | null;
  model_allowlist: string | null;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
}

export interface GatewayKeyLimits {
  rpmLimit: number | null;
  dailyRequestLimit: number | null;
  dailyTokenLimit: number | null;
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
  daily_request_limit: number | null;
  daily_token_limit: number | null;
  expires_at: number | null;
  model_allowlist: string[];
  created_at: number;
  updated_at: number;
}

export function toPublicKey(row: GatewayKeyRow): GatewayKeyPublic {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    status: row.status,
    rpm_limit: row.rpm_limit,
    daily_request_limit: row.daily_request_limit,
    daily_token_limit: row.daily_token_limit,
    expires_at: row.expires_at,
    model_allowlist: parseModelAllowlist(row.model_allowlist),
    created_at: row.created_at,
    updated_at: row.updated_at,
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
    .prepare('SELECT * FROM gateway_api_keys ORDER BY created_at DESC')
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
    daily_request_limit?: number | null;
    daily_token_limit?: number | null;
    expires_at?: number | null;
    model_allowlist?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO gateway_api_keys
        (id, name, key_prefix, key_hash, rpm_limit, daily_request_limit, daily_token_limit, expires_at, model_allowlist)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      key.id,
      key.name,
      key.key_prefix,
      key.key_hash,
      key.rpm_limit ?? null,
      key.daily_request_limit ?? null,
      key.daily_token_limit ?? null,
      key.expires_at ?? null,
      key.model_allowlist ?? null,
    )
    .run();
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
    daily_request_limit?: number | null;
    daily_token_limit?: number | null;
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
  if (limits.daily_request_limit !== undefined) {
    fields.push('daily_request_limit = ?');
    values.push(limits.daily_request_limit);
  }
  if (limits.daily_token_limit !== undefined) {
    fields.push('daily_token_limit = ?');
    values.push(limits.daily_token_limit);
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
