import { describe, expect, test } from 'vitest';
import { TtlLruCache } from '../src/cache/ttl-lru.ts';

describe('per-isolate TTL/LRU cache', () => {
  test('expires entries without relying on timers', () => {
    let now = 1_000;
    const cache = new TtlLruCache<string, string>(2, () => now);

    cache.set('key', 'value', 100);
    expect(cache.get('key')).toBe('value');

    now = 1_100;
    expect(cache.get('key')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test('evicts the least recently used entry at capacity', () => {
    const cache = new TtlLruCache<string, number>(2, () => 0);
    cache.set('a', 1, 1_000);
    cache.set('b', 2, 1_000);
    expect(cache.get('a')).toBe(1); // a becomes most recently used

    cache.set('c', 3, 1_000);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });
});
