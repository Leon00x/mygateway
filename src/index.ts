/**
 * MyGateway — Cloudflare AI Aggregation Gateway
 * Worker entry point and top-level routing.
 */

import { Env, parseConfig, ConfigError } from './env.ts';
import { generateRequestId } from './http/request-id.ts';
import { gatewayErrorResponse } from './http/errors.ts';
import { logConfigError, logEvent } from './shared/log.ts';
import { handleAdminApi } from './admin/router.ts';
import { handleGateway } from './gateway/router.ts';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Health check (no auth) ---
    if (path === '/health') {
      return Response.json({
        status: 'ok',
        version: env.APP_VERSION ?? '0.1.0',
      });
    }

    // --- Validate config ---
    let config;
    try {
      config = parseConfig(env);
    } catch (e) {
      if (e instanceof ConfigError) {
        logConfigError(e.message);
        return gatewayErrorResponse(
          'config_error',
          'Server configuration error. Check Worker Secrets.',
          generateRequestId(),
        );
      }
      throw e;
    }

    // --- Gateway API ---
    if (path.startsWith('/v1/')) {
      return handleGateway(request, url, env, ctx);
    }

    // --- Admin API ---
    if (path.startsWith('/admin/api/')) {
      return handleAdminApi(request, url, env);
    }

    // --- Static assets (management dashboard) ---
    if (['GET', 'HEAD'].includes(request.method)) {
      try {
        return env.ASSETS.fetch(request);
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    }

    return new Response('Method Not Allowed', { status: 405 });
  },

  /**
   * Cron: daily usage cleanup.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = parseConfig(env);
    const { cleanupOldUsage } = await import('./db/usage.ts');
    const deletedRows = await cleanupOldUsage(env.DB, config.usageRetentionDays);

    logEvent({
      event: 'cron_cleanup_completed',
      timestamp: new Date().toISOString(),
      deleted_rows: deletedRows,
      retention_days: config.usageRetentionDays,
    });
  },
};
