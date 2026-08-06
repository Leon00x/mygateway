/**
 * Virtual-key quota enforcement.
 *
 * - RPM is a per-isolate sliding-minute window (best effort, like the passive
 *   circuit breaker — losing isolate state is safe).
 * - Daily budgets are authoritative in D1 (key_daily_usage). To avoid a D1
 *   read on every request, each isolate keeps a small ledger per key: a D1
 *   base snapshot refreshed every `quotaRefreshMs` plus the requests this
 *   isolate completed since the snapshot (bumped by the usage recorder).
 *   Budgets may overshoot by at most the traffic served by *other* isolates
 *   inside one refresh window — bounded, and invisible for a single-isolate
 *   personal gateway.
 */

import { TtlLruCache } from '../cache/ttl-lru.ts';
import { readKeyDailyUsage, utcDateString, type KeyDailyUsage } from '../db/requests.ts';
import type { GatewayKeyIdentity } from './access-resolver.ts';

const RPM_WINDOW_MS = 70_000;
const rpmWindow = new TtlLruCache<string, { minute: number; count: number }>(10_000);

interface QuotaLedgerEntry {
  date: string;
  base: KeyDailyUsage;
  local: KeyDailyUsage;
}

const quotaLedger = new TtlLruCache<string, QuotaLedgerEntry>(5_000);
let quotaRefreshMs = 5_000;

export type QuotaReason = 'expired' | 'rpm' | 'daily_requests' | 'daily_tokens';

export type QuotaDecision = { allowed: true } | { allowed: false; reason: QuotaReason };

/** Configure the D1 refresh interval (from KEY_QUOTA_REFRESH_MS). */
export function configureKeyQuota(refreshMs: number): void {
  quotaRefreshMs = refreshMs > 0 ? refreshMs : 5_000;
}

/** Test-only reset of per-isolate quota state. */
export function resetKeyQuota(): void {
  rpmWindow.clear();
  quotaLedger.clear();
}

/** Key expired (expires_at set and passed). */
export function keyIsExpired(
  key: GatewayKeyIdentity,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
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

function emptyUsage(): KeyDailyUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 };
}

function addUsage(a: KeyDailyUsage, b: KeyDailyUsage): KeyDailyUsage {
  return {
    requests: a.requests + b.requests,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costMicros: a.costMicros + b.costMicros,
  };
}

/**
 * Called by the usage recorder after a completed request so the isolate's
 * ledger reflects work it has already done. The ledger entry keeps its
 * original expiry so the D1 base still refreshes on schedule.
 */
export function bumpKeyQuotaLedger(keyId: string, delta: KeyDailyUsage): void {
  const entry = quotaLedger.get(keyId);
  if (!entry) return; // no active ledger → next check re-reads fresh D1 anyway
  entry.local = addUsage(entry.local, delta);
}

/**
 * Authoritative daily budget check. Reads D1 at most once per refresh window
 * per key; between refreshes it adds the isolate's own completed requests.
 */
export async function checkDailyQuota(
  db: D1Database,
  key: GatewayKeyIdentity,
  date: string = utcDateString(),
): Promise<QuotaDecision> {
  const hasRequestLimit = key.dailyRequestLimit !== null && key.dailyRequestLimit !== undefined;
  const hasTokenLimit = key.dailyTokenLimit !== null && key.dailyTokenLimit !== undefined;
  if (!hasRequestLimit && !hasTokenLimit) return { allowed: true };

  let entry = quotaLedger.get(key.id);
  if (!entry || entry.date !== date) {
    const base = await readKeyDailyUsage(db, key.id, date);
    entry = { date, base, local: emptyUsage() };
    quotaLedger.set(key.id, entry, quotaRefreshMs + 10_000);
  }

  const usage = addUsage(entry.base, entry.local);
  if (hasRequestLimit && usage.requests >= (key.dailyRequestLimit as number)) {
    return { allowed: false, reason: 'daily_requests' };
  }
  const totalTokens = usage.inputTokens + usage.outputTokens;
  if (hasTokenLimit && totalTokens >= (key.dailyTokenLimit as number)) {
    return { allowed: false, reason: 'daily_tokens' };
  }
  return { allowed: true };
}
