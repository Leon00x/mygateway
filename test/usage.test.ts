import { describe, expect, test } from 'vitest';
import { getUsageRange } from '../src/db/usage.ts';

describe('usage time ranges', () => {
  test('today starts at Asia/Shanghai local midnight', () => {
    const now = Date.UTC(2026, 7, 4, 10, 30, 15); // 18:30:15 in Shanghai
    const range = getUsageRange('today', 'Asia/Shanghai', now);

    expect(range.start).toBe(Date.UTC(2026, 7, 3, 16) / 1_000);
    expect(range.end).toBe(Date.UTC(2026, 7, 4, 10, 31) / 1_000);
  });

  test('today honors a DST timezone', () => {
    const now = Date.UTC(2026, 6, 15, 18); // 14:00 in New York (EDT)
    const range = getUsageRange('today', 'America/New_York', now);

    expect(range.start).toBe(Date.UTC(2026, 6, 15, 4) / 1_000);
  });

  test('7d remains a rolling range ending at the next minute', () => {
    const now = Date.UTC(2026, 7, 4, 10, 30, 15);
    const range = getUsageRange('7d', 'Asia/Shanghai', now);

    expect(range.start).toBe(Math.floor((now - 7 * 86_400_000) / 60_000) * 60);
    expect(range.end).toBe(Math.floor(now / 60_000) * 60 + 60);
  });
});
