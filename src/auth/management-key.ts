import { TtlLruCache } from '../cache/ttl-lru.ts';
import { findActiveManagementKeyByHash, type ManagementKeyRow } from '../db/management-keys.ts';
import { sha256Hex } from '../shared/ids.ts';

const managementKeyCache = new TtlLruCache<string, ManagementKeyRow | null>(200);

export function extractManagementKey(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer\s+(mgmt_[A-Za-z0-9_-]{32,})$/i);
  return match?.[1] ?? null;
}

export function managementKeyPrefix(key: string): string {
  return key.slice(0, 13);
}

export async function authenticateManagementKey(
  request: Request,
  db: D1Database,
): Promise<ManagementKeyRow | null> {
  const raw = extractManagementKey(request);
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const cached = managementKeyCache.get(hash);
  if (cached !== undefined) return cached;
  const row = await findActiveManagementKeyByHash(db, hash);
  const ttlMs = row ? Math.max(1, Math.min(30_000, row.expires_at * 1000 - Date.now())) : 5_000;
  managementKeyCache.set(hash, row, ttlMs);
  return row;
}

export function invalidateManagementKeyCache(): void {
  managementKeyCache.clear();
}
