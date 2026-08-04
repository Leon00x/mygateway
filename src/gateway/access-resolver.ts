import { TtlLruCache } from '../cache/ttl-lru.ts';
import type { CandidateRow } from '../db/models.ts';

const ACTIVE_KEY_TTL_MS = 30_000;
const INACTIVE_KEY_TTL_MS = 5_000;
const RESOLVED_MODEL_TTL_MS = 60_000;
const UNRESOLVED_MODEL_TTL_MS = 5_000;

const keyCache = new TtlLruCache<string, CachedGatewayKey>(1_000);
const modelCache = new TtlLruCache<string, CachedModelResolution>(200);

export interface GatewayKeyIdentity {
  id: string;
  name: string;
}

export interface ResolvedModel {
  direct: boolean;
  candidates: CandidateRow[];
  unifiedModelId: string;
  modelCardId: string;
}

type CachedGatewayKey =
  | { active: true; identity: GatewayKeyIdentity }
  | { active: false };

export type ModelResolution =
  | { status: 'resolved'; value: ResolvedModel }
  | { status: 'not_found' }
  | { status: 'unavailable' };

type CachedModelResolution = ModelResolution;

interface RouteQueryRow extends Partial<CandidateRow> {
  identifier_type: 'unified' | 'alias';
  model_card_id: string;
  direct_channel_model_id: string | null;
}

const KEY_QUERY = `
  SELECT id, name
  FROM gateway_api_keys
  WHERE key_hash = ? AND status = 'active' AND revoked_at IS NULL
  LIMIT 1
`;

// LEFT JOIN keeps one identifier row even when every candidate is disabled, so
// callers can distinguish an unknown model from a temporarily unavailable one.
const ROUTE_QUERY = `
  SELECT
    mi.identifier_type,
    mi.model_card_id,
    mi.channel_model_id AS direct_channel_model_id,
    cm.id AS channel_model_id_pk,
    cm.channel_model_id,
    cm.public_model_alias,
    cm.sort_order,
    cm.supports_stream_usage,
    c.id AS channel_id,
    c.name AS channel_name,
    c.provider_type,
    c.base_url,
    c.api_key_ciphertext,
    c.api_key_iv,
    c.api_key_version
  FROM model_identifiers mi
  JOIN model_cards mc
    ON mc.id = mi.model_card_id
  LEFT JOIN channel_models cm
    ON cm.model_card_id = mi.model_card_id
   AND mc.status = 'active'
   AND mc.deleted_at IS NULL
   AND cm.status = 'active'
   AND cm.deleted_at IS NULL
   AND (mi.identifier_type = 'unified' OR cm.id = mi.channel_model_id)
  LEFT JOIN channels c
    ON c.id = cm.channel_id
   AND c.status = 'active'
   AND c.deleted_at IS NULL
  WHERE mi.identifier = ?
  ORDER BY cm.sort_order ASC, cm.id ASC
`;

function readKeyResult(rows: unknown[]): CachedGatewayKey {
  const row = rows[0] as GatewayKeyIdentity | undefined;
  return row ? { active: true, identity: row } : { active: false };
}

function readModelResult(modelName: string, rows: unknown[]): ModelResolution {
  const routeRows = rows as RouteQueryRow[];
  const marker = routeRows[0];
  if (!marker) return { status: 'not_found' };

  const candidates = routeRows.filter(
    (row): row is RouteQueryRow & CandidateRow =>
      typeof row.channel_model_id_pk === 'string' && typeof row.channel_id === 'string',
  );

  if (marker.identifier_type === 'alias') {
    const direct = candidates.find(
      (candidate) => candidate.channel_model_id_pk === marker.direct_channel_model_id,
    );
    if (!direct) return { status: 'unavailable' };
    return {
      status: 'resolved',
      value: {
        direct: true,
        candidates: [direct],
        unifiedModelId: modelName,
        modelCardId: marker.model_card_id,
      },
    };
  }

  if (candidates.length === 0) return { status: 'unavailable' };
  return {
    status: 'resolved',
    value: {
      direct: false,
      candidates,
      unifiedModelId: modelName,
      modelCardId: marker.model_card_id,
    },
  };
}

function cacheKey(keyHash: string, value: CachedGatewayKey): void {
  keyCache.set(keyHash, value, value.active ? ACTIVE_KEY_TTL_MS : INACTIVE_KEY_TTL_MS);
}

function cacheModel(modelName: string, value: ModelResolution): void {
  modelCache.set(
    modelName,
    value,
    value.status === 'resolved' ? RESOLVED_MODEL_TTL_MS : UNRESOLVED_MODEL_TTL_MS,
  );
}

export async function authenticateGatewayKeyHash(
  db: D1Database,
  keyHash: string,
): Promise<GatewayKeyIdentity | null> {
  const cached = keyCache.get(keyHash);
  if (cached) return cached.active ? cached.identity : null;

  const result = await db.prepare(KEY_QUERY).bind(keyHash).all<GatewayKeyIdentity>();
  const resolved = readKeyResult(result.results);
  cacheKey(keyHash, resolved);
  return resolved.active ? resolved.identity : null;
}

/**
 * Resolve gateway authentication and model routing in one D1 round trip on a
 * full cache miss. Partial misses only query the missing value.
 */
export async function resolveGatewayAccess(
  db: D1Database,
  keyHash: string,
  modelName: string,
): Promise<{ key: GatewayKeyIdentity | null; model: ModelResolution }> {
  const cachedKey = keyCache.get(keyHash);
  const cachedModel = modelCache.get(modelName);

  if (cachedKey && !cachedKey.active) {
    return { key: null, model: cachedModel ?? { status: 'not_found' } };
  }
  if (cachedKey && cachedModel) {
    return { key: cachedKey.identity, model: cachedModel };
  }

  const statements: D1PreparedStatement[] = [];
  let keyResultIndex = -1;
  let modelResultIndex = -1;

  if (!cachedKey) {
    keyResultIndex = statements.length;
    statements.push(db.prepare(KEY_QUERY).bind(keyHash));
  }
  if (!cachedModel) {
    modelResultIndex = statements.length;
    statements.push(db.prepare(ROUTE_QUERY).bind(modelName));
  }

  const results = await db.batch(statements);

  const resolvedKey = cachedKey ?? readKeyResult(results[keyResultIndex].results);
  if (!cachedKey) cacheKey(keyHash, resolvedKey);

  const resolvedModel = cachedModel ?? readModelResult(modelName, results[modelResultIndex].results);
  // An invalid caller may supply arbitrary model names. Return the already
  // fetched result, but do not let unauthenticated traffic churn the route cache.
  if (!cachedModel && resolvedKey.active) cacheModel(modelName, resolvedModel);

  return {
    key: resolvedKey.active ? resolvedKey.identity : null,
    model: resolvedModel,
  };
}

export function invalidateGatewayKeyCache(): void {
  keyCache.clear();
}

export function invalidateModelRouteCache(): void {
  modelCache.clear();
}

/** Test-only reset for module-level isolate state. */
export function resetGatewayAccessCaches(): void {
  keyCache.clear();
  modelCache.clear();
}
