import { describe, expect, test } from 'vitest';
import { classifyUpstreamError } from '../src/gateway/fallback-policy.ts';

describe('fallback policy', () => {
  test.each([408, 429, 500, 502, 503])('retries status %s before response commit', (status) => {
    expect(classifyUpstreamError(status)).toBe('retryable');
  });

  test.each([400, 401, 403, 404, 422])('does not retry status %s', (status) => {
    expect(classifyUpstreamError(status)).toBe('not_retryable');
  });

  test('retries network failures', () => {
    expect(classifyUpstreamError(null, new Error('network'))).toBe('retryable');
  });
});
