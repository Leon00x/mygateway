/**
 * Fallback policy — classify upstream errors to decide whether to try next candidate.
 */

export type UpstreamErrorKind =
  | 'retryable'      // Connection failure, timeout, 429, 5xx → try next
  | 'not_retryable'  // 400, content filter, etc. → return error
  | 'stream_error';   // Error after stream started → terminate

/**
 * Classify an upstream response/error to determine fallback behavior.
 */
export function classifyUpstreamError(
  status: number | null,
  error?: Error,
): UpstreamErrorKind {
  // Network/connection error
  if (error && !status) {
    return 'retryable';
  }

  if (status === null) return 'retryable';

  // Retryable: timeout, rate limit, server errors
  if (status === 408 || status === 429 || status >= 500) {
    return 'retryable';
  }

  // Not retryable: client errors (400, 401, 403, 404, etc.)
  return 'not_retryable';
}

/**
 * Check if a specific HTTP status should trigger fallback.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
