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
      bind: (...params: unknown[]) => ({
        _sql: sql,
        _params: params,
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
    batch: async (stmts: Array<{ _sql?: string; _params?: unknown[] }>) => {
      for (const s of stmts) {
        if (typeof s._sql === 'string') {
          statements.push({ sql: s._sql, params: s._params ?? [] });
        }
      }
    },
  } as unknown as D1Database;
  return { db, statements };
}

const defaultPolicy = () => ({ logsEnabled: true, logSuccess: true, logErrors: true, logContext: false });

const ctx = (overrides: Partial<UsageRecordContext> = {}): UsageRecordContext => ({
  modelCardId: 'mc-1',
  unifiedModelId: 'deepseek-chat',
  channelId: 'ch-1',
  channelName: 'DeepSeek',
  inputPriceMicrosPerMillion: null,
  outputPriceMicrosPerMillion: null,
  cacheInputPriceMicrosPerMillion: null,
  attemptCount: 1,
  fallbackOccurred: false,
  stream: false,
  cached: false,
  keyId: 'key-1',
  keyName: 'test-key',
  requestId: 'req-1',
  policy: defaultPolicy(),
  ...overrides,
});

function insertStatements(statements: { sql: string }[]): number {
  return statements.filter((s) => s.sql.includes('INSERT INTO request_logs')).length;
}

describe('log policy', () => {
  beforeEach(() => resetLogPolicyCache());
  afterEach(() => resetLogPolicyCache());

  test('missing settings default correctly (logContext=false, others=true)', async () => {
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
    expect(policy).toEqual({ logsEnabled: true, logSuccess: true, logErrors: true, logContext: false });
    await readLogPolicy(db);
    expect(reads).toBe(4); // one per key, cached after first read
  });

  test('invalidateLogPolicyCache forces a re-read after an admin update', async () => {
    const values: Record<string, string> = {
      request_logs_enabled: 'true',
      log_success: 'true',
      log_errors: 'true',
      log_context: 'false',
    };
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          const key = params[0] as string;
          return {
            first: async () => values[key] !== undefined ? { value: values[key] } : null,
            all: async () => ({ results: [] }),
            run: async () => ({ meta: {} }),
          };
        },
      }),
    } as unknown as D1Database;

    expect((await readLogPolicy(db)).logErrors).toBe(true);
    values['log_errors'] = 'false';
    // cached → still true
    expect((await readLogPolicy(db)).logErrors).toBe(true);
    invalidateLogPolicyCache();
    expect((await readLogPolicy(db)).logErrors).toBe(false);
  });
});

describe('usage recorder level gating', () => {
  test('success rows are skipped when log_success is off', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ policy: { ...defaultPolicy(), logSuccess: false } }),
      'success',
      { inputTokens: 10, outputTokens: 5 },
      12,
    );
    expect(insertStatements(statements)).toBe(0);
    expect(statements.some((s) => s.sql.includes('INSERT INTO analytics_minutes'))).toBe(true);
    expect(statements.some((s) => s.sql.includes('INSERT INTO key_daily_usage'))).toBe(true);
  });

  test('error rows are skipped when log_errors is off', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ policy: { ...defaultPolicy(), logErrors: false } }),
      'error',
      null,
      12,
      'upstream_http_500: boom',
    );
    expect(insertStatements(statements)).toBe(0);
    expect(statements.some((s) => s.sql.includes('INSERT INTO analytics_minutes'))).toBe(true);
  });

  test('all log rows skipped when request_logs_enabled is off', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ policy: { ...defaultPolicy(), logsEnabled: false } }),
      'success',
      { inputTokens: 10, outputTokens: 5 },
      12,
    );
    expect(insertStatements(statements)).toBe(0);
    expect(statements.some((s) => s.sql.includes('INSERT INTO analytics_minutes'))).toBe(true);
    expect(statements.some((s) => s.sql.includes('INSERT INTO key_daily_usage'))).toBe(true);
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
      { ...defaultPolicy(), logErrors: false },
      'rpm_limit_exceeded',
    );
    expect(insertStatements(statements)).toBe(0);
  });

  test('rejected requests are gated by logsEnabled master switch', async () => {
    const { db, statements } = fakeDb({});
    await recordRejectedRequest(
      envOf(db),
      { keyId: 'key-1', keyName: 'k', requestId: 'r', model: 'm', modelCardId: null },
      'rate_limited',
      5,
      { ...defaultPolicy(), logsEnabled: false },
      'rpm_limit_exceeded',
    );
    expect(insertStatements(statements)).toBe(0);
  });

  test('analytics always recorded even when all logs off', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ policy: { logsEnabled: false, logSuccess: false, logErrors: false, logContext: false } }),
      'success',
      { inputTokens: 100, outputTokens: 50 },
      200,
    );
    // analytics_minutes and key_daily_usage always written; usage_minutes no longer written separately
    // Batch contains analytics + key_daily_usage = 2 statements (no log, no usage_minutes)
    expect(statements.length).toBe(2);
    expect(statements.some((s) => s.sql.includes('INSERT INTO analytics_minutes'))).toBe(true);
    expect(statements.some((s) => s.sql.includes('INSERT INTO key_daily_usage'))).toBe(true);
    expect(insertStatements(statements)).toBe(0);
  });

  test('TTFT is recorded in analytics when stream=true', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ stream: true, ttftMs: 345 }),
      'success',
      { inputTokens: 50, outputTokens: 30 },
      500,
    );
    const analyticsStmt = statements.find((s) => s.sql.includes('INSERT INTO analytics_minutes'));
    expect(analyticsStmt).toBeDefined();
    // ttft_ms_sum should be 345, ttft_ms_count should be 1
    const sumIdx = analyticsStmt!.params.length - 2;
    const countIdx = analyticsStmt!.params.length - 1;
    expect(analyticsStmt!.params[sumIdx]).toBe(345);
    expect(analyticsStmt!.params[countIdx]).toBe(1);
  });

  test('TTFT not recorded for non-streaming requests', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ stream: false, ttftMs: undefined }),
      'success',
      { inputTokens: 50, outputTokens: 30 },
      500,
    );
    const analyticsStmt = statements.find((s) => s.sql.includes('INSERT INTO analytics_minutes'));
    expect(analyticsStmt).toBeDefined();
    const sumIdx = analyticsStmt!.params.length - 2;
    const countIdx = analyticsStmt!.params.length - 1;
    expect(analyticsStmt!.params[sumIdx]).toBe(0);
    expect(analyticsStmt!.params[countIdx]).toBe(0);
  });

  test('context not written when log_context is off', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({
        policy: { ...defaultPolicy(), logContext: false },
        contextRequest: 'hello world',
        contextResponse: 'hi there',
      }),
      'success',
      { inputTokens: 10, outputTokens: 5 },
      12,
    );
    const insert = statements.find((s) => s.sql.includes('INSERT INTO request_logs'));
    expect(insert).toBeDefined();
    // context columns should be null
    const cols = insert!.sql;
    expect(cols).toContain('context_request_iv');
    // The params for context columns should be null
    const nullCount = insert!.params.filter((p: unknown) => p === null).length;
    expect(nullCount).toBeGreaterThanOrEqual(6); // 6 context columns all null
  });

  test('batch statement counts: completed with log = 3 statements (analytics + key + log)', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ policy: defaultPolicy() }),
      'success',
      { inputTokens: 10, outputTokens: 5 },
      12,
    );
    // analytics_minutes + key_daily_usage + request_logs = 3
    expect(statements.length).toBe(3);
  });

  test('batch statement counts: completed without log = 2 statements', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ policy: { ...defaultPolicy(), logsEnabled: false } }),
      'success',
      { inputTokens: 10, outputTokens: 5 },
      12,
    );
    // analytics_minutes + key_daily_usage only
    expect(statements.length).toBe(2);
  });

  test('batch statement counts: rejected with log = 2 statements', async () => {
    const { db, statements } = fakeDb({});
    await recordRejectedRequest(
      envOf(db),
      { keyId: 'key-1', keyName: 'k', requestId: 'r', model: 'm', modelCardId: null },
      'rate_limited',
      5,
      defaultPolicy(),
      'rpm_limit_exceeded',
    );
    // analytics_minutes + request_logs
    expect(statements.length).toBe(2);
  });

  test('batch statement counts: rejected without log = 1 statement', async () => {
    const { db, statements } = fakeDb({});
    await recordRejectedRequest(
      envOf(db),
      { keyId: 'key-1', keyName: 'k', requestId: 'r', model: 'm', modelCardId: null },
      'rate_limited',
      5,
      { ...defaultPolicy(), logsEnabled: false },
      'rpm_limit_exceeded',
    );
    // analytics_minutes only
    expect(statements.length).toBe(1);
  });

  test('request_logs includes ttft_ms and requested_protocol', async () => {
    const { db, statements } = fakeDb({});
    await recordRequestCompletion(
      envOf(db),
      ctx({ stream: true, ttftMs: 123, requestedProtocol: 'openai_chat' }),
      'success',
      { inputTokens: 10, outputTokens: 5 },
      450,
    );
    const insert = statements.find((s) => s.sql.includes('INSERT INTO request_logs'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('ttft_ms');
    expect(insert!.sql).toContain('requested_protocol');
    // Find ttft_ms value in params
    expect(insert!.params).toContain(123);
    expect(insert!.params).toContain('openai_chat');
  });

  test('rejected request_logs includes ttft_ms (null)', async () => {
    const { db, statements } = fakeDb({});
    await recordRejectedRequest(
      envOf(db),
      { keyId: 'key-1', keyName: 'k', requestId: 'r', model: 'm', modelCardId: null },
      'rate_limited',
      5,
      defaultPolicy(),
      'rpm_limit_exceeded',
    );
    const insert = statements.find((s) => s.sql.includes('INSERT INTO request_logs'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('ttft_ms');
    // ttft_ms should be null for rejected request
    // Count nulls - ttft_ms, model_card_id, channel_id, channel_name should all be null
    const nullCount = insert!.params.filter((p: unknown) => p === null).length;
    expect(nullCount).toBeGreaterThanOrEqual(2);
  });
});
