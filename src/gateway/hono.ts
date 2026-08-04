/**
 * Gateway /v1/* — Hono + OpenAPI.
 *
 * Minimal migration: existing handlers are reused as-is; Hono provides
 * routing, OpenAPI generation and the Scalar docs page.
 */

import { Hono } from 'hono';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';
import { Env } from '../env.ts';
import { extractGatewayKey, hashGatewayKey } from '../auth/gateway-key.ts';
import { findActiveKeyByHash } from '../db/keys.ts';
import { handleChatCompletions } from './chat-completions.ts';
import { handleModelsList } from './models-list.ts';

// Env type for Hono handlers — reuse the full Env so existing handlers type-check.
type Bindings = Env;

// Variables stored per-request (middleware → handler)
interface Variables {
  requestId: string;
}

export const gatewayApp = new OpenAPIHono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

// --- Auth middleware: validate Bearer gateway key, attach requestId ---
// Registered BEFORE routes so it intercepts every /v1/* request.
gatewayApp.use('/v1/*', async (c, next) => {
  const requestId = `gw-${crypto.randomUUID()}`;
  c.set('requestId', requestId);

  // Skip auth for docs endpoints
  if (c.req.path === '/v1/api-docs' || c.req.path === '/v1/openapi.json') {
    return next();
  }

  const rawKey = extractGatewayKey(c.req.raw);
  if (!rawKey) {
    return c.json(
      {
        error: {
          message: 'Missing or invalid API key',
          type: 'gateway_error',
          param: null,
          code: 'invalid_api_key',
        },
      },
      401,
    );
  }

  const keyHash = await hashGatewayKey(rawKey);
  const keyRecord = await findActiveKeyByHash(c.env.DB, keyHash);
  if (!keyRecord) {
    return c.json(
      {
        error: {
          message: 'Invalid API key',
          type: 'gateway_error',
          param: null,
          code: 'invalid_api_key',
        },
      },
      401,
    );
  }

  return next();
});

// --- OpenAPI metadata ---
gatewayApp.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Gateway API key (gw_...)',
});

gatewayApp.doc31('/v1/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'MyGateway API',
    version: '0.1.0',
    description:
      'Cloudflare AI Aggregation Gateway — OpenAI-compatible unified model access with fixed-priority routing and pre-response fallback.',
  },
  servers: [{ url: '/' }],
});

// --- Scalar docs page ---
gatewayApp.get('/v1/api-docs', apiReference({
  spec: { url: '/v1/openapi.json' },
  pageTitle: 'MyGateway API Docs',
}));

// --- GET /v1/models ---
const modelsRoute = createRoute({
  method: 'get',
  path: '/v1/models',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'List of available models',
      content: {
        'application/json': {
          schema: z.object({
            object: z.literal('list'),
            data: z.array(
              z.object({
                id: z.string(),
                object: z.literal('model'),
                created: z.number(),
                owned_by: z.string(),
              }),
            ),
          }),
        },
      },
    },
    401: { description: 'Invalid or missing API key' },
  },
});

gatewayApp.openapi(modelsRoute, async (c) => {
  const requestId = c.get('requestId') as string;
  const response = await handleModelsList(c.env, requestId);
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

// --- POST /v1/chat/completions ---
const chatRoute = createRoute({
  method: 'post',
  path: '/v1/chat/completions',
  security: [{ bearerAuth: [] }],
  // NOTE: no `request.body` schema — the existing handler parses the body
  // itself (readLimitedBody + JSON.parse). Declaring a body schema would
  // make Hono's zValidator lock the ReadableStream, breaking body reads.
  responses: {
    200: {
      description: 'Chat completion response (JSON or SSE stream)',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            object: z.string(),
            created: z.number(),
            model: z.string(),
            choices: z.array(z.unknown()),
          }),
        },
        'text/event-stream': { schema: z.string() },
      },
    },
    400: { description: 'Invalid request' },
    401: { description: 'Invalid or missing API key' },
    404: { description: 'Model not found' },
    429: { description: 'Upstream rate limited' },
  },
});

gatewayApp.openapi(chatRoute, async (c) => {
  const requestId = c.get('requestId') as string;
  // Reconstruct a standard Request from c.req so the existing handler works unchanged
  const upstream = c.req.raw;
  const response = await handleChatCompletions(upstream, c.env, c.executionCtx as unknown as ExecutionContext, requestId);
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

/**
 * Handle /v1/* with Hono. Returns undefined if the path is not a gateway route
 * (caller can fall through to static assets).
 */
export async function handleGatewayHono(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | undefined> {
  // Only intercept /v1/* paths; everything else → undefined (fall through)
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/')) {
    return undefined;
  }

  const envAdapter = env as Bindings;

  const response = await gatewayApp.fetch(request, envAdapter, ctx);
  // Hono returns 404 for unknown /v1/* routes — we return undefined so the
  // caller can produce a proper gateway error instead.
  if (response.status === 404) {
    return undefined;
  }
  return response;
}
