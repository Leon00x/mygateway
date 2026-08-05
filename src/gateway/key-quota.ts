/**
 * Virtual-key quota enforcement.
 *
 * - RPM is a per-isolate sliding-minute window (best effort, like the passive
 *   circuit breaker — losing isolate state is safe).
 * - Daily budgets are authoritative in D1 (key_daily_usage), checked before
 *   routing and updated after each completed request.
 */

import { TtlLruCache } from '../cache/ttl-lru.ts';
import { readKeyDailyUsage, utcDateString } from '../db/requests.ts';
import type { GatewayKeyIdentity } from './access-resolver.ts';

const RPM_WINDOW_MS = 70_000;
const rpmWindow = new TtlLruCache<string, { minute: number; count: number }>(10_000);

export type QuotaReason = 'expired' | 'rpm' | 'daily_requests' | 'daily_tokens';

export type QuotaDecision = { allowed: true } | { allowed: false; reason: QuotaReason };

/** Key expired (expires_at set and passed). */
export function keyIsExpired(key: GatewayKeyIdentity, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  return key.expiresAt !== null && key.expiresAt > 0 && nowSeconds > key.expiresAt;
}

/**
 * Sliding-minute RPM gate. Returns true when the request is allowed.
 * Only enforced when rpmLimit is set.
 */
export function checkRpm(keyId: string, rpmLimit: number | null): boolean {
  if (rpmLimit === null || rpmLimit === undefined || rpmLimit <= 0) return true;
  const minute = Math.floor(Date.now() / 60_000);
  const entry = rpmWindow.get(keyId);
  if (!entry || entry.minute !== minute) {
    rpmWindow.set(keyId, { minute, count: 1 }, RPM_WINDOW_MS);
    return true;
  }
  if (entry.count >= rpmLimit) return false;
  entry.count += 1;
  rpmWindow.set(keyId, entry, RPM_WINDOW_MS);
  return true;
}

/**
 * Authoritative D1 daily budget check. Reads today's aggregate for the key and
 * compares against daily_request_limit / daily_token_limit (both optional).
 */
export async function checkDailyQuota(
  db: D1Database,
  key: GatewayKeyIdentity,
  date: string = utcDateString(),
): Promise<QuotaDecision> {
  const hasRequestLimit = key.dailyRequestLimit !== null && key.dailyRequestLimit !== undefined;
  const hasTokenLimit = key.dailyTokenLimit !== null && key.dailyTokenLimit !== undefined;
  if (!hasRequestLimit && !hasTokenLimit) return { allowed: true };

  const usage = await readKeyDailyUsage(db, key.id, date);
  if (hasRequestLimit && usage.requests >= (key.dailyRequestLimit as number)) {
    return { allowed: false, reason: 'daily_requests' };
  }
  const totalTokens = usage.inputTokens + usage.outputTokens;
  if (hasTokenLimit && totalTokens >= (key.dailyTokenLimit as number)) {
    return { allowed: false, reason: 'daily_tokens' };
  }
  return { allowed: true };
}

/** Test-only reset for the per-isolate RPM window. */
export function resetRpmWindow(): void {
  rpmWindow.clear();
}
