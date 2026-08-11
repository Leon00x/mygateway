export type ManagementPermission = 'read' | 'write';
export const PERMANENT_MANAGEMENT_KEY_EXPIRY = 253_402_300_799;

export interface ManagementKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  permission: ManagementPermission;
  status: 'active' | 'disabled';
  expires_at: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
}

export interface ManagementKeyPublic extends Omit<ManagementKeyRow, 'key_hash' | 'expires_at' | 'revoked_at'> {
  expires_at: number | null;
}

export function toPublicManagementKey(row: ManagementKeyRow): ManagementKeyPublic {
  const { key_hash: _hash, expires_at: expiresAt, revoked_at: _revokedAt, ...safe } = row;
  return {
    ...safe,
    expires_at: expiresAt >= PERMANENT_MANAGEMENT_KEY_EXPIRY ? null : expiresAt,
  };
}

export async function listManagementKeys(db: D1Database): Promise<ManagementKeyRow[]> {
  return (await db.prepare('SELECT * FROM management_keys ORDER BY created_at DESC').all<ManagementKeyRow>()).results;
}

export async function getManagementKey(db: D1Database, id: string): Promise<ManagementKeyRow | null> {
  return db.prepare('SELECT * FROM management_keys WHERE id = ? LIMIT 1').bind(id).first<ManagementKeyRow>();
}

export async function createManagementKey(db: D1Database, key: {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  permission: ManagementPermission;
  expiresAt: number;
}): Promise<void> {
  await db.prepare(
    `INSERT INTO management_keys (id, name, key_prefix, key_hash, permission, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(key.id, key.name, key.keyPrefix, key.keyHash, key.permission, key.expiresAt).run();
}

export async function findActiveManagementKeyByHash(
  db: D1Database,
  keyHash: string,
): Promise<ManagementKeyRow | null> {
  return db.prepare(
    `SELECT * FROM management_keys
     WHERE key_hash = ? AND status = 'active' AND revoked_at IS NULL AND expires_at > unixepoch()
     LIMIT 1`,
  ).bind(keyHash).first<ManagementKeyRow>();
}

export async function updateManagementKey(db: D1Database, id: string, update: {
  name?: string;
  permission?: ManagementPermission;
  status?: 'active' | 'disabled';
  expiresAt?: number;
}): Promise<void> {
  const fields = ['updated_at = unixepoch()'];
  const values: unknown[] = [];
  if (update.name !== undefined) { fields.push('name = ?'); values.push(update.name); }
  if (update.permission !== undefined) { fields.push('permission = ?'); values.push(update.permission); }
  if (update.status !== undefined) { fields.push('status = ?'); values.push(update.status); }
  if (update.expiresAt !== undefined) { fields.push('expires_at = ?'); values.push(update.expiresAt); }
  values.push(id);
  await db.prepare(`UPDATE management_keys SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteManagementKey(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM management_keys WHERE id = ?').bind(id).run();
}

export async function recordManagementAudit(db: D1Database, entry: {
  id: string;
  keyId: string;
  method: string;
  path: string;
  status: number;
  requestId: string;
}): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO management_audit_logs
       (id, management_key_id, method, path, status, request_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(entry.id, entry.keyId, entry.method, entry.path, entry.status, entry.requestId),
    db.prepare(
      `UPDATE management_keys SET last_used_at = unixepoch()
       WHERE id = ? AND (last_used_at IS NULL OR last_used_at < unixepoch() - 300)`,
    ).bind(entry.keyId),
  ]);
}

export async function cleanupManagementAudit(db: D1Database, retentionDays: number): Promise<number> {
  const result = await db.prepare(
    'DELETE FROM management_audit_logs WHERE created_at < unixepoch() - ? * 86400',
  ).bind(retentionDays).run();
  return result.meta.changes ?? 0;
}
