import { describe, expect, test } from 'vitest';
import {
  PassiveCircuitBreaker,
  selectCircuitCandidates,
} from '../src/gateway/passive-circuit-breaker.ts';

describe('passive circuit breaker', () => {
  test('opens after consecutive retryable failures', () => {
    let now = 1_000;
    const breaker = new PassiveCircuitBreaker(3, 30_000, 10, () => now);

    expect(breaker.recordFailure('channel-1')).toMatchObject({ failures: 1, opened: false });
    expect(breaker.recordFailure('channel-1')).toMatchObject({ failures: 2, opened: false });
    expect(breaker.recordFailure('channel-1')).toMatchObject({ failures: 3, opened: true });
    expect(breaker.shouldAttempt('channel-1')).toEqual({
      allowed: false,
      probe: false,
      retryAfterMs: 30_000,
    });

    now += 29_999;
    expect(breaker.shouldAttempt('channel-1').allowed).toBe(false);
  });

  test('uses the first real request after cooldown as a recovery probe', () => {
    let now = 0;
    const breaker = new PassiveCircuitBreaker(2, 1_000, 10, () => now);
    breaker.recordFailure('channel-1');
    breaker.recordFailure('channel-1');

    now = 1_000;
    expect(breaker.shouldAttempt('channel-1')).toEqual({
      allowed: true,
      probe: true,
      retryAfterMs: 0,
    });
    expect(breaker.recordFailure('channel-1')).toMatchObject({ failures: 2, opened: true });
  });

  test('success and administrative reset close the circuit', () => {
    const breaker = new PassiveCircuitBreaker(1, 30_000);
    breaker.recordFailure('channel-1');
    breaker.recordSuccess('channel-1');
    expect(breaker.shouldAttempt('channel-1').allowed).toBe(true);

    breaker.recordFailure('channel-1');
    breaker.reset('channel-1');
    expect(breaker.shouldAttempt('channel-1').allowed).toBe(true);
  });

  test('bounds isolate memory with LRU eviction', () => {
    const breaker = new PassiveCircuitBreaker(1, 30_000, 2);
    breaker.recordFailure('a');
    breaker.recordFailure('b');
    breaker.shouldAttempt('a'); // a becomes most recently used
    breaker.recordFailure('c');

    expect(breaker.shouldAttempt('a').allowed).toBe(false);
    expect(breaker.shouldAttempt('b').allowed).toBe(true); // evicted
    expect(breaker.shouldAttempt('c').allowed).toBe(false);
  });

  test('replaces an open preferred channel with later fallbacks', () => {
    const breaker = new PassiveCircuitBreaker(1, 30_000, 10, () => 1_000);
    breaker.recordFailure('preferred');

    const result = selectCircuitCandidates([
      { channel_id: 'preferred', name: 'Preferred' },
      { channel_id: 'fallback-1', name: 'Fallback 1' },
      { channel_id: 'fallback-2', name: 'Fallback 2' },
    ], 2, breaker);

    expect(result.selected.map(({ candidate }) => candidate.channel_id)).toEqual([
      'fallback-1',
      'fallback-2',
    ]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ position: 0, retryAfterMs: 30_000 });
  });
});
