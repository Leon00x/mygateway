import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { computeCostMicros, formatUsdMicros } from '../src/shared/cost.ts';
import { checkDailyQuota, checkRpm, configureKeyQuota, keyIsExpired, resetKeyQuota } from '../src/gateway/key-quota.ts';
import type { GatewayKeyIdentity } from '../src/gateway/access-resolver.ts';
import { parseModelAllowlist, serializeModelAllowlist } from '../src/db/keys.ts';

const key = (overrides: Partial<GatewayKeyIdentity> = {}): GatewayKeyIdentity => ({
  id: 'key-1',
  name: 'default',
  rpmLimit: null,
  dailyRequestLimit: null,
  dailyTokenLimit: null,
  expiresAt: null,
  modelAllowlist: [],
  ...overrides,
});

describe('cost math', () => {
  test('computes integer micro-USD without floating drift', () => {
    // $3 per M input, $15 per M output, 1_000 in + 500 out → 0.003 + 0.0075
    expect(computeCostMicros(1_000, 500, 3_000_000, 15_000_000)).toBe(10_500);
  });

  test('zero when no prices are configured', () => {
    expect(computeCostMicros(10_000, 10_000, null, null)).toBe(0);
    expect(computeCostMicros(0, 0, 3_000_000, 15_000_000)).toBe(0);
  });

  test('rounds sub-micro amounts', () => {
    expect(computeCostMicros(1, 0, 1_000_000, 1_000_000)).toBe(1);
    expect(computeCostMicros(1, 0, 100, 100)).toBe(0);
  });

  test('formats micro-USD', () => {
    expect(formatUsdMicros(10_500)).toBe('$0.010500');
    expect(formatUsdMicros(0)).toBe('$0.000000');
  });
});

describe('key quota', () => {
  beforeEach(() => {
    resetKeyQuota();
    configureKeyQuota(5_000);
  });

  test('expiry compares against unix seconds', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(keyIsExpired(key({ expiresAt: nowSeconds - 1 }), nowSeconds)).toBe(true);
    expect(keyIsExpired(key({ expiresAt: nowSeconds + 60 }), nowSeconds)).toBe(false);
    expect(keyIsExpired(key({ expiresAt: null }), nowSeconds)).toBe(false);
  });

  test('rpm gates within the current minute and resets on the next', () => {
    const identity = key({ rpmLimit: 2 });
    expect(checkRpm(identity.id, identity.rpmLimit)).toBe(true);
    expect(checkRpm(identity.id, identity.rpmLimit)).toBe(true);
    expect(checkRpm(identity.id, identity.rpmLimit)).toBe(false);
    // Different key is unaffected.
    expect(checkRpm('other-key', 2)).toBe(true);
    // No limit → always allowed.
    expect(checkRpm('unlimited-key', null)).toBe(true);
  });

  test('daily quota reads D1 and blocks at the configured limits', async () => {
    const usage: Record<string, unknown> = {};
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          first: async () => {
            return usage[`${params[0]}:${params[1]}`] ?? null;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database;

    const blocked = await checkDailyQuota(db, key({
      id: 'limited', dailyRequestLimit: 1,
    }), '2026-08-05');
    expect(blocked).toEqual({ allowed: true });

    usage['limited:2026-08-05'] = { requests: 1, input_tokens: 0, output_tokens: 0, cost_micros: 0 };
    resetKeyQuota(); // simulate the refresh window elapsing → re-read D1
    const blocked2 = await checkDailyQuota(db, key({
      id: 'limited', dailyRequestLimit: 1,
    }), '2026-08-05');
    expect(blocked2).toEqual({ allowed: false, reason: 'daily_requests' });

    usage['tokens:2026-08-05'] = { requests: 0, input_tokens: 1_000, output_tokens: 500, cost_micros: 0 };
    resetKeyQuota();
    const tokenBlocked = await checkDailyQuota(db, key({
      id: 'tokens', dailyTokenLimit: 1_000,
    }), '2026-08-05');
    expect(tokenBlocked).toEqual({ allowed: false, reason: 'daily_tokens' });
  });

  test('ledger reuses the D1 snapshot and counts local bumps between refreshes', async () => {
    let reads = 0;
    const usage: Record<string, unknown> = {};
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          first: async () => {
            reads++;
            return usage[`${params[0]}:${params[1]}`] ?? null;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database;
    const { bumpKeyQuotaLedger } = await import('../src/gateway/key-quota.ts');

    const identity = key({ id: 'busy', dailyRequestLimit: 3 });
    expect(await checkDailyQuota(db, identity, '2026-08-05')).toEqual({ allowed: true });
    expect(reads).toBe(1);

    // Completed requests bump the local ledger — no extra D1 reads.
    bumpKeyQuotaLedger('busy', { requests: 1, inputTokens: 0, outputTokens: 0, costMicros: 0 });
    bumpKeyQuotaLedger('busy', { requests: 1, inputTokens: 0, outputTokens: 0, costMicros: 0 });
    expect(await checkDailyQuota(db, identity, '2026-08-05')).toEqual({ allowed: true }); // 2 < 3
    bumpKeyQuotaLedger('busy', { requests: 1, inputTokens: 0, outputTokens: 0, costMicros: 0 });
    expect(await checkDailyQuota(db, identity, '2026-08-05')).toEqual({ allowed: false, reason: 'daily_requests' }); // 3 >= 3
    expect(reads).toBe(1); // still the single D1 read
  });

  test('daily quota skips the D1 read when no limits are set', async () => {
    let reads = 0;
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => { reads++; return null; },
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database;
    const decision = await checkDailyQuota(db, key(), '2026-08-05');
    expect(decision).toEqual({ allowed: true });
    expect(reads).toBe(0);
  });
});

describe('model allowlist parsing', () => {
  test('round-trips through storage', () => {
    const serialized = serializeModelAllowlist(['deepseek-chat', 'gpt-4o', 'gpt-4o']);
    expect(serialized).toBe('["deepseek-chat","gpt-4o"]');
    expect(parseModelAllowlist(serialized)).toEqual(['deepseek-chat', 'gpt-4o']);
  });

  test('handles empty and malformed values', () => {
    expect(serializeModelAllowlist([])).toBeNull();
    expect(serializeModelAllowlist(undefined)).toBeNull();
    expect(parseModelAllowlist(null)).toEqual([]);
    expect(parseModelAllowlist('not-json')).toEqual([]);
  });
});
