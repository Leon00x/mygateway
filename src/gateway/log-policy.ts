/**
 * Request-log level policy.
 *
 * Two independent switches decide which rows are written to request_logs:
 *   log_success — normal successful requests
 *   log_errors  — errors, cancellations, and rejected (quota/access) requests
 *
 * Usage aggregates (usage_minutes) and per-key budgets (key_daily_usage) are
 * NEVER affected by these switches — only the detail log is.
 *
 * Settings live in D1 and are cached per isolate for 60s so the hot path
 * does not read D1 per request; admin changes propagate within a minute.
 */

import { TtlLruCache } from '../cache/ttl-lru.ts';
import { getSetting } from '../db/settings.ts';

export interface LogPolicy {
  logSuccess: boolean;
  logErrors: boolean;
}

const POLICY_TTL_MS = 60_000;
const settingCache = new TtlLruCache<string, boolean>(16);

function cachedOrDefault(db: D1Database, key: string): Promise<boolean> {
  const cached = settingCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return getSetting(db, key).then((raw) => {
    // Absent setting (migration not applied yet) → behave as enabled.
    const value = raw !== 'false';
    settingCache.set(key, value, POLICY_TTL_MS);
    return value;
  });
}

export async function readLogPolicy(db: D1Database): Promise<LogPolicy> {
  const [logSuccess, logErrors] = await Promise.all([
    cachedOrDefault(db, 'log_success'),
    cachedOrDefault(db, 'log_errors'),
  ]);
  return { logSuccess, logErrors };
}

/** Admin edit landed — drop the cached flags so the next read is fresh. */
export function invalidateLogPolicyCache(): void {
  settingCache.clear();
}

/** Test-only reset. */
export function resetLogPolicyCache(): void {
  settingCache.clear();
}
