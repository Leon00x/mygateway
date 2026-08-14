import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { computeCostMicros, formatUsdMicros } from '../src/shared/cost.ts';
import { checkQuota, checkRpm, configureKeyQuota, keyIsExpired, resetKeyQuota } from '../src/gateway/key-quota.ts';
import type { GatewayKeyIdentity } from '../src/gateway/access-resolver.ts';
import { quotaWindow } from '../src/shared/key-limits.ts';
import {
  cleanupExpiredTemporaryGatewayKeys,
  listGatewayKeys,
  parseModelAllowlist,
  serializeModelAllowlist,
  toPublicKey,
} from '../src/db/keys.ts';

const key = (overrides: Partial<GatewayKeyIdentity> = {}): GatewayKeyIdentity => ({
  id: 'key-1',
  name: 'default',
  rpmLimit: null,
  requestLimit: null,
  tokenLimit: null,
  limitPeriod: 'day',
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
  const now = Date.UTC(2026, 7, 5, 12);

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

  test('natural UTC windows cover day, ISO week, month, and year boundaries', () => {
    expect(quotaWindow('day', now)).toEqual({ period: 'day', startDate: '2026-08-05', endDate: '2026-08-06' });
    expect(quotaWindow('week', now)).toEqual({ period: 'week', startDate: '2026-08-03', endDate: '2026-08-10' });
    expect(quotaWindow('month', now)).toEqual({ period: 'month', startDate: '2026-08-01', endDate: '2026-09-01' });
    expect(quotaWindow('year', now)).toEqual({ period: 'year', startDate: '2026-01-01', endDate: '2027-01-01' });
  });

  test('period quota reads one indexed D1 range and blocks at configured limits', async () => {
    const usage: Record<string, unknown> = {};
    let statement = '';
    let bindings: unknown[] = [];
    const db = {
      prepare: (sql: string) => {
        statement = sql;
        return {
          bind: (...params: unknown[]) => {
            bindings = params;
            return {
              first: async () => usage[`${params[0]}:${params[1]}:${params[2]}`] ?? null,
              all: async () => ({ results: [] }),
              run: async () => ({ meta: { changes: 1 } }),
            };
          },
        };
      },
    } as unknown as D1Database;

    const blocked = await checkQuota(db, key({
      id: 'limited', requestLimit: 1, limitPeriod: 'week',
    }), now);
    expect(blocked).toEqual({ allowed: true });
    expect(statement).toContain('WHERE key_id = ? AND date >= ? AND date < ?');
    expect(bindings).toEqual(['limited', '2026-08-03', '2026-08-10']);

    usage['limited:2026-08-03:2026-08-10'] = { requests: 1, input_tokens: 0, output_tokens: 0, cost_micros: 0 };
    resetKeyQuota(); // simulate the refresh window elapsing → re-read D1
    const blocked2 = await checkQuota(db, key({
      id: 'limited', requestLimit: 1, limitPeriod: 'week',
    }), now);
    expect(blocked2).toEqual({ allowed: false, reason: 'request_limit' });

    usage['tokens:2026-01-01:2027-01-01'] = { requests: 0, input_tokens: 1_000, output_tokens: 500, cost_micros: 0 };
    resetKeyQuota();
    const tokenBlocked = await checkQuota(db, key({
      id: 'tokens', tokenLimit: 1_000, limitPeriod: 'year',
    }), now);
    expect(tokenBlocked).toEqual({ allowed: false, reason: 'token_limit' });
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

    const identity = key({ id: 'busy', requestLimit: 3 });
    expect(await checkQuota(db, identity, now)).toEqual({ allowed: true });
    expect(reads).toBe(1);

    // Completed requests bump the local ledger — no extra D1 reads.
    bumpKeyQuotaLedger('busy', { requests: 1, inputTokens: 0, outputTokens: 0, costMicros: 0 });
    bumpKeyQuotaLedger('busy', { requests: 1, inputTokens: 0, outputTokens: 0, costMicros: 0 });
    expect(await checkQuota(db, identity, now)).toEqual({ allowed: true }); // 2 < 3
    bumpKeyQuotaLedger('busy', { requests: 1, inputTokens: 0, outputTokens: 0, costMicros: 0 });
    expect(await checkQuota(db, identity, now)).toEqual({ allowed: false, reason: 'request_limit' }); // 3 >= 3
    expect(reads).toBe(1); // still the single D1 read
  });

  test('coalesces concurrent cold-cache checks into one D1 read', async () => {
    let reads = 0;
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            reads++;
            await Promise.resolve();
            return { requests: 0, input_tokens: 0, output_tokens: 0, cost_micros: 0 };
          },
        }),
      }),
    } as unknown as D1Database;
    const identity = key({ id: 'concurrent', tokenLimit: 1_000, limitPeriod: 'month' });
    await Promise.all([checkQuota(db, identity, now), checkQuota(db, identity, now)]);
    expect(reads).toBe(1);
  });

  test('period quota skips the D1 read when no limits are set', async () => {
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
    const decision = await checkQuota(db, key(), now);
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

test('an explicitly cleared migrated budget does not fall back to stale legacy values', () => {
  const publicKey = toPublicKey({
    id: 'cleared', name: 'cleared', key_prefix: 'gw_clear', key_hash: 'hash', status: 'active',
    rpm_limit: null, request_limit: null, token_limit: null, limit_period: 'day',
    daily_request_limit: 100, daily_token_limit: 1_000, expires_at: null, model_allowlist: null,
    created_at: 1, updated_at: 1, revoked_at: null, is_temporary: 0,
  });
  expect(publicKey).toMatchObject({
    request_limit: null,
    token_limit: null,
    daily_request_limit: null,
    daily_token_limit: null,
  });
});

describe('temporary gateway key persistence', () => {
  test('list query hides expired temporary keys without deleting regular keys', async () => {
    let statement = '';
    const db = {
      prepare: (sql: string) => {
        statement = sql;
        return { all: async () => ({ results: [] }) };
      },
    } as unknown as D1Database;

    await listGatewayKeys(db);
    expect(statement).toContain('is_temporary = 0');
    expect(statement).toContain('expires_at > unixepoch()');
  });

  test('lazy cleanup only deletes expired server-marked temporary keys', async () => {
    let statement = '';
    const db = {
      prepare: (sql: string) => {
        statement = sql;
        return { run: async () => ({ meta: { changes: 2 } }) };
      },
    } as unknown as D1Database;

    expect(await cleanupExpiredTemporaryGatewayKeys(db)).toBe(2);
    expect(statement).toContain('is_temporary = 1');
    expect(statement).toContain('expires_at <= unixepoch()');
  });
});
