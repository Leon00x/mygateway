import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readLogPolicy, invalidateLogPolicyCache, resetLogPolicyCache } from '../src/gateway/log-policy.ts';
import type { Env } from '../src/env.ts';
import { recordRejectedRequest, recordRequestCompletion, type UsageRecordContext } from '../src/gateway/usage-recorder.ts';

const envOf = (db: D1Database) => ({ DB: db } as unknown as Env);

/** Tracks every SQL statement executed against the fake D1. */
function fakeDb(_rows: Record<string, unknown>) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => {
        statements.push({ sql, params });
        return {
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        };
      },
    }),
  } as unknown as D1Database;
  return { db, statements };
}

const ctx = (overrides: Partial<UsageRecordContext> = {}): UsageRecordContext => ({
  modelCardId: 'mc-1',
  unifiedModelId: 'deepseek-chat',
  channelId: 'ch-1',
  channelName: 'DeepSeek',
  inputPriceMicrosPerMillion: null,
  outputPriceMicrosPerMillion: null,
  attemptCount: 1,
  fallbackOccurred: false,
  stream: false,
  cached: false,
  keyId: 'key-1',
  keyName: 'test-key',
  requestId: 'req-1',
  policy: { logSuccess: true, logErrors: true },
  ...overrides,
});

function insertStatements(statements: { sql: string }[]): number {
  return statements.filter((s) => s.sql.includes('INSERT INTO request_logs')).length;
}

describe('log policy', () => {
  beforeEach(() => resetLogPolicyCache());
  afterEach(() => resetLogPolicyCache());

  test('missing settings default to enabled and are cached', async () => {
    let reads = 0;
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          reads++;
          return { first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) };
        },
      }),
    } as unknown as D1Database;
    const policy = await readLogPolicy(db);
    expect(policy).toEqual({ logSuccess: true, logErrors: true });
    await readLogPolicy(db);
    expect(reads).toBe(2); // one per key, cached after first read
  });

  test('invalidateLogPolicyCache forces a re-read after an admin update', async () => {
    let value: string | null = 'true';
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          const next = () => Promise.resolve({ value: params[1] as string });
          return {
            first: async () => (value === null ? null : { value }),
            all: async () => ({ results: [] }),
            run: async () => ({ meta: {} }),
          };
        },
      }),
    } as unknown as D1Database;

    expect((await readLogPolicy(db)).logErrors).toBe(true);
    value = 'false';
    // cached → still true
    expect((await readLogPolicy(db)).logErrors).toBe(true);
    invalidateLogPolicyCache();
    expect((await readLogPolicy(db)).logErrors).toBe(false);
  });
});

describe('usage recorder level gating', () => {
  test('success rows are skipped when log_success is off, usage still written', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ policy: { logSuccess: false, logErrors: true } }),
      'success',
      { inputTokens: 10, outputTokens: 5 },
      12,
    );
    expect(insertStatements(statements)).toBe(0);
    expect(statements.some((s) => s.sql.includes('INSERT INTO usage_minutes'))).toBe(true);
    expect(statements.some((s) => s.sql.includes('INSERT INTO key_daily_usage'))).toBe(true);
  });

  test('error rows are skipped when log_errors is off', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ policy: { logSuccess: true, logErrors: false } }),
      'error',
      null,
      12,
      'upstream_http_500: boom',
    );
    expect(insertStatements(statements)).toBe(0);
    // usage error_count still recorded
    expect(statements.some((s) => s.sql.includes('INSERT INTO usage_minutes'))).toBe(true);
  });

  test('error_detail is stored with error rows when enabled', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx(),
      'error',
      null,
      12,
      'upstream_http_502: bad gateway',
    );
    expect(insertStatements(statements)).toBe(1);
    const insert = statements.find((s) => s.sql.includes('INSERT INTO request_logs'))!;
    expect(insert.params).toContain('upstream_http_502: bad gateway');
  });

  test('rejected requests are gated by log_errors', async () => {
    const { db, statements } = fakeDb({});
    await recordRejectedRequest(
      envOf(db),
      { keyId: 'key-1', keyName: 'k', requestId: 'r', model: 'm', modelCardId: null },
      'rate_limited',
      5,
      { logSuccess: true, logErrors: false },
      'rpm_limit_exceeded',
    );
    expect(insertStatements(statements)).toBe(0);
  });
});
