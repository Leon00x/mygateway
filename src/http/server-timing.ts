import type { GatewayAccessMetrics } from '../gateway/access-resolver.ts';

export interface GatewayResponseTiming {
  access?: GatewayAccessMetrics;
  upstreamTtfbMs?: number;
  gatewayTtfbMs?: number;
}

function duration(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

/** Attach browser/curl-readable timings without requiring a metrics backend. */
export function applyServerTiming(response: Response, timing: GatewayResponseTiming): Response {
  const metrics: string[] = [];
  if (timing.access) {
    metrics.push(`gateway-cache;desc="${timing.access.cacheStatus}"`);
    metrics.push(`gateway-access;dur=${duration(timing.access.accessMs)}`);
    metrics.push(`gateway-d1;dur=${duration(timing.access.d1Ms)}`);
  }
  if (timing.upstreamTtfbMs !== undefined) {
    metrics.push(`upstream-ttfb;dur=${duration(timing.upstreamTtfbMs)}`);
  }
  if (timing.gatewayTtfbMs !== undefined) {
    metrics.push(`gateway-ttfb;dur=${duration(timing.gatewayTtfbMs)}`);
  }
  if (metrics.length > 0) {
    const value = metrics.join(', ');
    // Cloudflare may manage Server-Timing for its cfWorker/RUM metrics. Keep
    // the standard header, and provide a stable gateway-specific equivalent.
    response.headers.set('Server-Timing', value);
    response.headers.set('X-Gateway-Timing', value);
  }
  return response;
}
