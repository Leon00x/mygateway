/**
 * Gateway API Key database operations.
 */

export interface GatewayKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  status: 'active' | 'disabled';
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
}

/** Key as returned to admin API (no hash). */
export interface GatewayKeyPublic {
  id: string;
  name: string;
  key_prefix: string;
  status: 'active' | 'disabled';
  created_at: number;
  updated_at: number;
}

export function toPublicKey(row: GatewayKeyRow): GatewayKeyPublic {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listGatewayKeys(db: D1Database): Promise<GatewayKeyRow[]> {
  const result = await db
    .prepare('SELECT * FROM gateway_api_keys ORDER BY created_at DESC')
    .all<GatewayKeyRow>();
  return result.results;
}

export async function createGatewayKey(
  db: D1Database,
  key: { id: string; name: string; key_prefix: string; key_hash: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO gateway_api_keys (id, name, key_prefix, key_hash)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(key.id, key.name, key.key_prefix, key.key_hash)
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
