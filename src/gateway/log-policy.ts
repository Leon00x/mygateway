/**
 * Request-log level policy and analytics settings.
 *
 * request_logs_enabled — master switch; when off, no request_logs rows are written.
 * log_success — normal successful requests
 * log_errors  — errors, cancellations, and rejected (quota/access) requests
 * log_context — request/response content preview (default off, requires explicit opt-in)
 *
 * When request_logs_enabled is off, context is never serialized or encrypted.
 *
 * Usage aggregates (analytics_minutes) and per-key budgets (key_daily_usage)
 * are NEVER affected by these switches — only the detail log is.
 *
 * Settings live in D1 and are cached per isolate for 60s so the hot path
 * does not read D1 per request; admin changes propagate within a minute.
 */

import { TtlLruCache } from '../cache/ttl-lru.ts';
import { getSetting } from '../db/settings.ts';

export interface LogPolicy {
  /** Master switch: when off, no request_logs rows are written at all. */
  logsEnabled: boolean;
  logSuccess: boolean;
  logErrors: boolean;
  /** Context recording (request + response preview). Defaults to off. */
  logContext: boolean;
}

const POLICY_TTL_MS = 60_000;
const settingCache = new TtlLruCache<string, boolean>(16);

function cachedOrDefault(db: D1Database, key: string): Promise<boolean> {
  const cached = settingCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return getSetting(db, key).then((raw) => {
    // Absent setting (migration not applied yet) → behave as enabled for
    // logs_enabled/log_success/log_errors, disabled for log_context.
    const defaultValue = key === 'log_context' ? false : true;
    const value = raw === null ? defaultValue : raw !== 'false';
    settingCache.set(key, value, POLICY_TTL_MS);
    return value;
  });
}

export async function readLogPolicy(db: D1Database): Promise<LogPolicy> {
  const [logsEnabled, logSuccess, logErrors, logContext] = await Promise.all([
    cachedOrDefault(db, 'request_logs_enabled'),
    cachedOrDefault(db, 'log_success'),
    cachedOrDefault(db, 'log_errors'),
    cachedOrDefault(db, 'log_context'),
  ]);
  return { logsEnabled, logSuccess, logErrors, logContext };
}

/** Admin edit landed — drop the cached flags so the next read is fresh. */
export function invalidateLogPolicyCache(): void {
  settingCache.clear();
}

/** Test-only reset. */
export function resetLogPolicyCache(): void {
  settingCache.clear();
}
