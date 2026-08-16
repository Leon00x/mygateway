/**
 * Per-isolate passive circuit breaker. It has no external storage or probes:
 * only real gateway attempts update state, and losing the state is safe.
 */

export interface CircuitDecision {
  allowed: boolean;
  probe: boolean;
  retryAfterMs: number;
}

export interface CircuitFailureResult {
  failures: number;
  opened: boolean;
  cooldownMs: number;
}

export interface CircuitCandidate {
  channel_id: string;
}

export interface SelectedCircuitCandidate<T> {
  candidate: T;
  circuitProbe: boolean;
}

export interface SkippedCircuitCandidate<T> {
  candidate: T;
  position: number;
  retryAfterMs: number;
}

interface CircuitEntry {
  failures: number;
  openUntil: number;
}

export class PassiveCircuitBreaker {
  private readonly entries = new Map<string, CircuitEntry>();

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 30_000,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
      throw new Error('failureThreshold must be a positive integer');
    }
    if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) {
      throw new Error('cooldownMs must be positive');
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('maxEntries must be a positive integer');
    }
  }

  shouldAttempt(channelId: string): CircuitDecision {
    const entry = this.entries.get(channelId);
    if (!entry) return { allowed: true, probe: false, retryAfterMs: 0 };

    this.touch(channelId, entry);
    const retryAfterMs = entry.openUntil - this.now();
    if (retryAfterMs > 0) {
      return { allowed: false, probe: false, retryAfterMs };
    }

    if (entry.openUntil > 0) {
      // The next real request is the passive recovery probe. Keeping the
      // failure count at threshold - 1 reopens immediately if it still fails.
      entry.openUntil = 0;
      entry.failures = this.failureThreshold - 1;
      return { allowed: true, probe: true, retryAfterMs: 0 };
    }

    return { allowed: true, probe: false, retryAfterMs: 0 };
  }

  recordFailure(channelId: string): CircuitFailureResult {
    const existing = this.entries.get(channelId);
    const entry: CircuitEntry = existing ?? { failures: 0, openUntil: 0 };
    entry.failures = Math.min(entry.failures + 1, this.failureThreshold);

    const opened = entry.failures >= this.failureThreshold;
    if (opened) entry.openUntil = this.now() + this.cooldownMs;

    this.touch(channelId, entry);
    this.evictOverflow();
    return { failures: entry.failures, opened, cooldownMs: opened ? this.cooldownMs : 0 };
  }

  recordSuccess(channelId: string): void {
    this.entries.delete(channelId);
  }

  reset(channelId?: string): void {
    if (channelId) this.entries.delete(channelId);
    else this.entries.clear();
  }

  private touch(channelId: string, entry: CircuitEntry): void {
    this.entries.delete(channelId);
    this.entries.set(channelId, entry);
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export const channelCircuitBreaker = new PassiveCircuitBreaker();

/** Select up to maxAttempts, replacing open candidates with later fallbacks. */
export function selectCircuitCandidates<T extends CircuitCandidate>(
  candidates: T[],
  maxAttempts: number,
  breaker: PassiveCircuitBreaker = channelCircuitBreaker,
): {
  selected: Array<SelectedCircuitCandidate<T>>;
  skipped: Array<SkippedCircuitCandidate<T>>;
} {
  const selected: Array<SelectedCircuitCandidate<T>> = [];
  const skipped: Array<SkippedCircuitCandidate<T>> = [];

  for (let position = 0; position < candidates.length; position++) {
    if (selected.length >= maxAttempts) break;
    const candidate = candidates[position];
    const decision = breaker.shouldAttempt(candidate.channel_id);
    if (decision.allowed) {
      selected.push({ candidate, circuitProbe: decision.probe });
    } else {
      skipped.push({ candidate, position, retryAfterMs: decision.retryAfterMs });
    }
  }

  return { selected, skipped };
}
