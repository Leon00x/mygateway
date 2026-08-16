import { describe, expect, test } from 'vitest';
import { applyServerTiming } from '../src/http/server-timing.ts';

describe('gateway Server-Timing', () => {
  test('formats cache, D1, upstream and gateway timings', () => {
    const response = applyServerTiming(new Response('ok'), {
      access: {
        cacheStatus: 'partial',
        keyCache: 'hit',
        modelCache: 'miss',
        d1Statements: 1,
        d1Ms: 1.236,
        accessMs: 2.345,
      },
      upstreamTtfbMs: 50.678,
      gatewayTtfbMs: 53.999,
    });

    const expected = 'gateway-cache;desc="partial", gateway-access;dur=2.35, gateway-d1;dur=1.24, '
      + 'upstream-ttfb;dur=50.68, gateway-ttfb;dur=54';
    expect(response.headers.get('Server-Timing')).toBe(expected);
    expect(response.headers.get('X-Gateway-Timing')).toBe(expected);
  });
});
