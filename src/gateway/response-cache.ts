/**
 * Isolate-local response cache for identical non-streaming requests.
 *
 * The cache is intentionally local and opt-in (RESPONSE_CACHE_TTL_MS > 0):
 * it saves cost and latency on repeated identical prompts without adding
 * shared state or D1/KV/DO writes. Cache hits are logged (cached=1) but do
 * not bill usage again — the original upstream call already paid for them.
 */

import { TtlLruCache } from '../cache/ttl-lru.ts';

export interface CachedCompletion {
  /** Full upstream response body (JSON text). */
  body: string;
  /** Upstream HTTP status (normally 200). */
  status: number;
  inputTokens: number;
  outputTokens: number;
}

export class ResponseCache {
  private readonly store: TtlLruCache<string, CachedCompletion>;

  constructor(
    readonly maxEntries: number,
    readonly ttlMs: number,
    now: () => number = Date.now,
  ) {
    this.store = new TtlLruCache<string, CachedCompletion>(maxEntries, now);
  }

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  key(model: string, bodyText: string): string {
    // Body already JSON-serialized; including the model keeps the key stable
    // when the same payload targets different model cards.
    return `${model}\u0000${bodyText}`;
  }

  get(key: string): CachedCompletion | undefined {
    return this.store.get(key);
  }

  set(key: string, value: CachedCompletion): void {
    this.store.set(key, value, this.ttlMs);
  }

  clear(): void {
    this.store.clear();
  }
}

let shared: ResponseCache | null = null;

export function getSharedResponseCache(maxEntries: number, ttlMs: number): ResponseCache {
  if (!shared || shared.maxEntries !== maxEntries || shared.ttlMs !== ttlMs) {
    shared = new ResponseCache(maxEntries, ttlMs);
  }
  return shared;
}

/** Test-only reset of the shared isolate cache. */
export function resetResponseCache(): void {
  shared = null;
}
