import { TtlLruCache } from '../cache/ttl-lru.ts';
import { hydrateCandidate, type CandidateQueryRow, type CandidateRow } from '../db/models.ts';

const ACTIVE_KEY_TTL_MS = 30_000;
const INACTIVE_KEY_TTL_MS = 5_000;
const RESOLVED_MODEL_TTL_MS = 60_000;
const UNRESOLVED_MODEL_TTL_MS = 5_000;

const keyCache = new TtlLruCache<string, CachedGatewayKey>(1_000);
const modelCache = new TtlLruCache<string, CachedModelResolution>(200);

export interface GatewayKeyIdentity {
  id: string;
  name: string;
  rpmLimit: number | null;
  dailyRequestLimit: number | null;
  dailyTokenLimit: number | null;
  expiresAt: number | null;
  modelAllowlist: string[];
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

export interface GatewayAccessMetrics {
  cacheStatus: 'hit' | 'partial' | 'miss';
  keyCache: 'hit' | 'miss';
  modelCache: 'hit' | 'miss' | 'skipped';
  d1Statements: number;
  d1Ms: number;
  accessMs: number;
}

export interface GatewayAccessResult {
  key: GatewayKeyIdentity | null;
  model: ModelResolution;
  metrics: GatewayAccessMetrics;
}

interface RouteQueryRow extends Partial<CandidateQueryRow> {
  identifier_type: 'unified' | 'alias';
  model_card_id: string;
  direct_channel_model_id: string | null;
}

const KEY_QUERY = `
  SELECT id, name, rpm_limit, daily_request_limit, daily_token_limit, expires_at, model_allowlist
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
    cm.input_price_micros_per_million,
    cm.output_price_micros_per_million,
    cm.cache_input_price_micros_per_million,
    c.id AS channel_id,
    c.name AS channel_name,
    c.provider_type,
    c.base_url,
    c.auth_type,
    c.oauth_connection_id,
    (SELECT json_group_array(json_object(
      'protocol', cp.protocol,
      'base_url', cp.base_url,
      'auth_scheme', cp.auth_scheme,
      'api_version', cp.api_version
    )) FROM channel_protocols cp WHERE cp.channel_id = c.id) AS protocols_json,
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
  const row = rows[0] as (GatewayKeyIdentity & {
    rpm_limit: number | null;
    daily_request_limit: number | null;
    daily_token_limit: number | null;
    expires_at: number | null;
    model_allowlist: string | null;
  }) | undefined;
  if (!row) return { active: false };
  return {
    active: true,
    identity: {
      id: row.id,
      name: row.name,
      rpmLimit: row.rpm_limit ?? null,
      dailyRequestLimit: row.daily_request_limit ?? null,
      dailyTokenLimit: row.daily_token_limit ?? null,
      expiresAt: row.expires_at ?? null,
      modelAllowlist: parseAllowlist(row.model_allowlist),
    },
  };
}

function parseAllowlist(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

function readModelResult(modelName: string, rows: unknown[]): ModelResolution {
  const routeRows = rows as RouteQueryRow[];
  const marker = routeRows[0];
  if (!marker) return { status: 'not_found' };

  const candidateRows = routeRows.filter(
    (row): row is RouteQueryRow & CandidateQueryRow =>
      typeof row.channel_model_id_pk === 'string' && typeof row.channel_id === 'string',
  );
  const candidates = candidateRows.map((row) => hydrateCandidate(row));

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
): Promise<GatewayAccessResult> {
  const accessStartedAt = performance.now();
  const cachedKey = keyCache.get(keyHash);
  const cachedModel = modelCache.get(modelName);

  const metrics = (
    d1Statements: number,
    d1Ms: number,
    modelCacheStatus: GatewayAccessMetrics['modelCache'] = cachedModel ? 'hit' : 'miss',
  ): GatewayAccessMetrics => {
    const modelSatisfiedWithoutD1 = modelCacheStatus !== 'miss';
    return {
      cacheStatus: cachedKey && modelSatisfiedWithoutD1
        ? 'hit'
        : cachedKey || modelSatisfiedWithoutD1 ? 'partial' : 'miss',
      keyCache: cachedKey ? 'hit' : 'miss',
      modelCache: modelCacheStatus,
      d1Statements,
      d1Ms: Math.round(d1Ms * 100) / 100,
      accessMs: Math.round((performance.now() - accessStartedAt) * 100) / 100,
    };
  };

  if (cachedKey && !cachedKey.active) {
    return {
      key: null,
      model: cachedModel ?? { status: 'not_found' },
      metrics: metrics(0, 0, cachedModel ? 'hit' : 'skipped'),
    };
  }
  if (cachedKey && cachedModel) {
    return { key: cachedKey.identity, model: cachedModel, metrics: metrics(0, 0) };
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

  const d1StartedAt = performance.now();
  const results = await db.batch(statements);
  const d1Ms = performance.now() - d1StartedAt;

  const resolvedKey = cachedKey ?? readKeyResult(results[keyResultIndex].results);
  if (!cachedKey) cacheKey(keyHash, resolvedKey);

  const resolvedModel = cachedModel ?? readModelResult(modelName, results[modelResultIndex].results);
  // An invalid caller may supply arbitrary model names. Return the already
  // fetched result, but do not let unauthenticated traffic churn the route cache.
  if (!cachedModel && resolvedKey.active) cacheModel(modelName, resolvedModel);

  return {
    key: resolvedKey.active ? resolvedKey.identity : null,
    model: resolvedModel,
    metrics: metrics(statements.length, d1Ms),
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
