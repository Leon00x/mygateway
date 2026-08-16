/**
 * Virtual-key quota enforcement.
 *
 * - RPM is a per-isolate sliding-minute window (best effort, like the passive
 *   circuit breaker — losing isolate state is safe).
 * - Period budgets are authoritative in D1 (daily authority rows summed over
 *   the current natural UTC day/week/month/year). To avoid a D1
 *   read on every request, each isolate keeps a small ledger per key: a D1
 *   base snapshot refreshed every `quotaRefreshMs` plus the requests this
 *   isolate completed since the snapshot (bumped by the usage recorder).
 *   Budgets may overshoot by at most the traffic served by *other* isolates
 *   inside one refresh window — bounded, and invisible for a single-isolate
 *   personal gateway.
 */

import { TtlLruCache } from '../cache/ttl-lru.ts';
import { readKeyPeriodUsage, type KeyDailyUsage } from '../db/requests.ts';
import { quotaWindow } from '../shared/key-limits.ts';
import type { GatewayKeyIdentity } from './access-resolver.ts';

const RPM_WINDOW_MS = 70_000;
const rpmWindow = new TtlLruCache<string, { minute: number; count: number }>(10_000);

interface QuotaLedgerEntry {
  windowKey: string;
  base: KeyDailyUsage;
  local: KeyDailyUsage;
}

const quotaLedger = new TtlLruCache<string, QuotaLedgerEntry>(5_000);
const quotaReads = new Map<string, Promise<KeyDailyUsage>>();
let quotaRefreshMs = 30_000;

export type QuotaReason = 'expired' | 'rpm' | 'request_limit' | 'token_limit';

export type QuotaDecision = { allowed: true } | { allowed: false; reason: QuotaReason };

/** Configure the D1 refresh interval (from KEY_QUOTA_REFRESH_MS). */
export function configureKeyQuota(refreshMs: number): void {
  quotaRefreshMs = refreshMs > 0 ? refreshMs : 30_000;
}

/** Test-only reset of per-isolate quota state. */
export function resetKeyQuota(): void {
  rpmWindow.clear();
  quotaLedger.clear();
  quotaReads.clear();
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
 * Authoritative period budget check. Limited keys read one indexed D1 range
 * at most once per refresh window per isolate; between refreshes the isolate
 * adds its own completed requests to the cached snapshot.
 */
export async function checkQuota(
  db: D1Database,
  key: GatewayKeyIdentity,
  nowMs: number = Date.now(),
): Promise<QuotaDecision> {
  const hasRequestLimit = key.requestLimit !== null && key.requestLimit !== undefined;
  const hasTokenLimit = key.tokenLimit !== null && key.tokenLimit !== undefined;
  if (!hasRequestLimit && !hasTokenLimit) return { allowed: true };

  const window = quotaWindow(key.limitPeriod, nowMs);
  const windowKey = `${window.period}:${window.startDate}:${window.endDate}`;
  let entry = quotaLedger.get(key.id);
  if (!entry || entry.windowKey !== windowKey) {
    const readKey = `${key.id}:${windowKey}`;
    let pending = quotaReads.get(readKey);
    if (!pending) {
      pending = readKeyPeriodUsage(db, key.id, window.startDate, window.endDate)
        .finally(() => quotaReads.delete(readKey));
      quotaReads.set(readKey, pending);
    }
    const base = await pending;
    entry = quotaLedger.get(key.id);
    if (!entry || entry.windowKey !== windowKey) {
      entry = { windowKey, base, local: emptyUsage() };
      quotaLedger.set(key.id, entry, quotaRefreshMs);
    }
  }

  const usage = addUsage(entry.base, entry.local);
  if (hasRequestLimit && usage.requests >= (key.requestLimit as number)) {
    return { allowed: false, reason: 'request_limit' };
  }
  const totalTokens = usage.inputTokens + usage.outputTokens;
  if (hasTokenLimit && totalTokens >= (key.tokenLimit as number)) {
    return { allowed: false, reason: 'token_limit' };
  }
  return { allowed: true };
}
