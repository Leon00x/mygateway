/**
 * Safe structured logging — never logs secrets, prompts, or response bodies.
 */

export interface LogEvent {
  event: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Emit a structured log event.
 * In Workers, this goes to console.log which appears in tail/real-time logs.
 */
export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify(event));
}

/** Convenience: log a gateway request started. */
export function logRequestStarted(requestId: string, model?: string): void {
  logEvent({
    event: 'gateway_request_started',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    model,
  });
}

/** Log an auth failure. */
export function logAuthFailed(requestId: string, reason: string): void {
  logEvent({
    event: 'gateway_auth_failed',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    reason,
  });
}

/** Log a config error at startup. */
export function logConfigError(message: string): void {
  logEvent({
    event: 'config_error',
    timestamp: new Date().toISOString(),
    message,
  });
}
