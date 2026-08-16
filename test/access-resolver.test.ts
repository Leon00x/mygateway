import { beforeEach, describe, expect, test } from 'vitest';
import {
  authenticateGatewayKeyHash,
  resetGatewayAccessCaches,
  resolveGatewayAccess,
} from '../src/gateway/access-resolver.ts';

interface FakeResult {
  results: unknown[];
}

class FakeStatement {
  params: unknown[] = [];

  constructor(
    readonly db: FakeD1,
    readonly sql: string,
  ) {}

  bind(...params: unknown[]): FakeStatement {
    this.params = params;
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.individualQueries++;
    return { results: this.db.rowsFor(this) as T[] };
  }
}

class FakeD1 {
  batches: FakeStatement[][] = [];
  individualQueries = 0;
  keyActive = true;

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]): Promise<FakeResult[]> {
    this.batches.push(statements);
    return statements.map((statement) => ({ results: this.rowsFor(statement) }));
  }

  rowsFor(statement: FakeStatement): unknown[] {
    if (statement.sql.includes('FROM gateway_api_keys')) {
      return this.keyActive ? [{
        id: 'key-1',
        name: 'default',
        rpm_limit: null,
        request_limit: null,
        token_limit: null,
        limit_period: 'day',
        expires_at: null,
        model_allowlist: null,
      }] : [];
    }
    if (statement.sql.includes('FROM model_identifiers')) {
      const modelName = statement.params[0];
      if (modelName === 'missing-model') return [];
      return [{
        identifier_type: 'unified',
        model_card_id: 'model-card-1',
        direct_channel_model_id: null,
        channel_model_id_pk: 'channel-model-1',
        channel_model_id: 'provider-model-1',
        public_model_alias: 'provider-model-1@primary',
        sort_order: 0,
        supports_stream_usage: 1,
        input_price_micros_per_million: null,
        output_price_micros_per_million: null,
        channel_id: 'channel-1',
        channel_name: 'Primary',
        provider_type: 'openai_compatible',
        base_url: 'https://provider.example/v1',
        api_key_ciphertext: 'ciphertext',
        api_key_iv: 'iv',
        api_key_version: 1,
      }];
    }
    throw new Error(`Unexpected query: ${statement.sql}`);
  }
}

describe('gateway access resolver', () => {
  beforeEach(() => resetGatewayAccessCaches());

  test('batches key authentication and model routing on a cold cache', async () => {
    const fake = new FakeD1();
    const db = fake as unknown as D1Database;

    const first = await resolveGatewayAccess(db, 'hash-1', 'unified-model');
    expect(first.key).toEqual({
      id: 'key-1',
      name: 'default',
      rpmLimit: null,
      requestLimit: null,
      tokenLimit: null,
      limitPeriod: 'day',
      expiresAt: null,
      modelAllowlist: [],
    });
    expect(first.model.status).toBe('resolved');
    expect(first.metrics).toMatchObject({
      cacheStatus: 'miss',
      keyCache: 'miss',
      modelCache: 'miss',
      d1Statements: 2,
    });
    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(2);

    const second = await resolveGatewayAccess(db, 'hash-1', 'unified-model');
    expect(second.key).toEqual(first.key);
    expect(second.model).toEqual(first.model);
    expect(second.metrics).toMatchObject({
      cacheStatus: 'hit',
      keyCache: 'hit',
      modelCache: 'hit',
      d1Statements: 0,
      d1Ms: 0,
    });
    expect(fake.batches).toHaveLength(1);
    expect(fake.individualQueries).toBe(0);
  });

  test('queries only the missing route after authentication is cached', async () => {
    const fake = new FakeD1();
    const db = fake as unknown as D1Database;

    await expect(authenticateGatewayKeyHash(db, 'hash-2')).resolves.toEqual({
      id: 'key-1',
      name: 'default',
      rpmLimit: null,
      requestLimit: null,
      tokenLimit: null,
      limitPeriod: 'day',
      expiresAt: null,
      modelAllowlist: [],
    });
    const result = await resolveGatewayAccess(db, 'hash-2', 'unified-model');

    expect(result.model.status).toBe('resolved');
    expect(result.metrics).toMatchObject({
      cacheStatus: 'partial',
      keyCache: 'hit',
      modelCache: 'miss',
      d1Statements: 1,
    });
    expect(fake.individualQueries).toBe(1);
    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(1);
  });

  test('negative-caches an invalid key and skips route queries', async () => {
    const fake = new FakeD1();
    fake.keyActive = false;
    const db = fake as unknown as D1Database;

    const first = await resolveGatewayAccess(db, 'invalid-hash', 'unified-model');
    const second = await resolveGatewayAccess(db, 'invalid-hash', 'another-model');

    expect(first.key).toBeNull();
    expect(second.key).toBeNull();
    expect(first.metrics).toMatchObject({ cacheStatus: 'miss', d1Statements: 2 });
    expect(second.metrics).toMatchObject({
      cacheStatus: 'hit',
      keyCache: 'hit',
      modelCache: 'skipped',
      d1Statements: 0,
      d1Ms: 0,
    });
    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(2);

    fake.keyActive = true;
    await resolveGatewayAccess(db, 'new-valid-hash', 'unified-model');
    expect(fake.batches).toHaveLength(2);
    expect(fake.batches[1]).toHaveLength(2); // invalid callers do not seed route cache
  });

  test('distinguishes an unknown model from an unavailable model', async () => {
    const fake = new FakeD1();
    const db = fake as unknown as D1Database;

    const missing = await resolveGatewayAccess(db, 'hash-3', 'missing-model');
    expect(missing.model).toEqual({ status: 'not_found' });
  });
});
