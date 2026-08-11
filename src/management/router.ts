import type { Env } from '../env.ts';
import { authenticateManagementKey } from '../auth/management-key.ts';
import { recordManagementAudit } from '../db/management-keys.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { generateRequestId } from '../http/request-id.ts';
import { generateId } from '../shared/ids.ts';
import { logAuthFailed } from '../shared/log.ts';
import {
  handleChannelDeleteImpact,
  handleChannelItem,
  handleChannelPreflight,
  handleChannelsCollection,
  handleChannelTest,
} from '../admin/channels.ts';
import { handleChannelBalance, handleChannelBalances } from '../admin/provider-balances.ts';
import {
  handleChannelModelImport,
  handleChannelModelRefresh,
  handleChannelProviderModels,
} from '../admin/model-discovery.ts';
import {
  handleModelInstanceItem,
  handleModelInstances,
  handleModelItem,
  handleModelsCollection,
  handleReorderInstances,
} from '../admin/models.ts';
import { handleKeyItem, handleKeysCollection, handleKeyRegenerate } from '../admin/keys.ts';
import { handleAnalyticsLogs, handleAnalyticsUsage } from '../admin/analytics.ts';
import { getLogById } from '../db/analytics.ts';

const API_PREFIX = '/management/v1';

function withMethod(request: Request, method: string): Request {
  return request.method === method ? request : new Request(request, { method });
}

function capabilityDocument(env: Env) {
  return {
    name: 'MyGateway Management API',
    api_version: 'v1',
    gateway_version: env.APP_VERSION ?? '0.1.0',
    permissions: ['read', 'write'],
    authentication: 'Authorization: Bearer mgmt_...',
    openapi_url: `${API_PREFIX}/openapi.json`,
    resources: ['channels', 'models', 'gateway_keys', 'analytics', 'logs', 'balances', 'system'],
  };
}

function openApiDocument(env: Env) {
  const bearer = [{ managementKey: [] }];
  const operation = (summary: string, permission: 'read' | 'write', success = 'Success') => ({
    summary,
    security: bearer,
    'x-required-permission': permission,
    responses: {
      '200': { description: success },
      '400': { description: 'Invalid request' },
      '401': { description: 'Invalid, expired, disabled, or revoked Management Key' },
      '403': { description: 'Write permission required' },
    },
  });
  return {
    openapi: '3.1.0',
    info: {
      title: 'MyGateway Management API',
      version: 'v1',
      description: 'Stable, scoped API for managing common MyGateway resources. Provider credentials are never returned.',
    },
    servers: [{ url: API_PREFIX }],
    components: {
      securitySchemes: { managementKey: { type: 'http', scheme: 'bearer', bearerFormat: 'mgmt_...' } },
    },
    paths: {
      '/capabilities': { get: { summary: 'Discover API capabilities', security: [], responses: { '200': { description: 'Capabilities' } } } },
      '/openapi.json': { get: { summary: 'Read this OpenAPI document', security: [], responses: { '200': { description: 'OpenAPI 3.1 document' } } } },
      '/channels/preflight': { post: operation('Test channel configuration and discover models without saving', 'write') },
      '/channels': {
        get: operation('List channels without Provider Keys', 'read'),
        post: operation('Create a channel', 'write', 'Created; Provider Key is never returned'),
      },
      '/channels/{id}': {
        get: operation('Read a channel without its Provider Key', 'read'),
        patch: operation('Update a channel or rotate its Provider Key', 'write'),
        delete: operation('Delete a channel', 'write', 'No content'),
      },
      '/channels/{id}/test': { post: operation('Test a saved channel connection', 'write') },
      '/channels/{id}/delete-impact': { get: operation('Inspect channel deletion impact', 'read') },
      '/channels/{id}/balance': { get: operation('Read or refresh one provider balance', 'read') },
      '/channels/{id}/models': {
        get: operation('List provider-model inventory', 'read'),
        post: operation('Add a provider model to inventory', 'write'),
        delete: operation('Remove a provider model from inventory', 'write', 'No content'),
      },
      '/channels/{id}/models/refresh': { post: operation('Refresh provider-model inventory', 'write') },
      '/channels/{id}/models/import': { post: operation('Import inventory models into unified models', 'write') },
      '/balances': { get: operation('Read or refresh supported provider balances', 'read') },
      '/models': {
        get: operation('List unified models and instances', 'read'),
        post: operation('Create a unified model', 'write', 'Created'),
      },
      '/models/{id}': {
        get: operation('Read a unified model and its instances', 'read'),
        patch: operation('Update a unified model', 'write'),
        delete: operation('Delete a unified model and its instances', 'write', 'No content'),
      },
      '/models/{id}/instances': { post: operation('Add a channel instance', 'write', 'Created') },
      '/models/{id}/instances/{instanceId}': { patch: operation('Update instance pricing and stream metadata', 'write') },
      '/models/{id}/instances/reorder': { put: operation('Set fallback order', 'write') },
      '/gateway-keys': {
        get: operation('List Gateway Keys without plaintext secrets', 'read'),
        post: operation('Create a Gateway Key', 'write', 'Created; plaintext returned once'),
      },
      '/gateway-keys/{id}': {
        patch: operation('Update a Gateway Key', 'write'),
        delete: operation('Delete a Gateway Key', 'write', 'No content'),
      },
      '/gateway-keys/{id}/regenerate': { post: operation('Regenerate a Gateway Key', 'write', 'Created; plaintext returned once') },
      '/analytics/usage': { get: operation('Query usage analytics', 'read') },
      '/logs': { get: operation('List request metadata logs without context', 'read') },
      '/logs/{id}': { get: operation('Read request metadata without stored context', 'read') },
      '/system/status': { get: operation('Read gateway status', 'read') },
    },
    'x-mygateway-capabilities': capabilityDocument(env),
  };
}

async function routeManagementResource(
  request: Request,
  url: URL,
  env: Env,
  requestId: string,
): Promise<Response> {
  const path = url.pathname.slice(API_PREFIX.length) || '/';

  if (path === '/channels/preflight') return handleChannelPreflight(request, env, requestId);
  if (path === '/channels') return handleChannelsCollection(request, env, requestId);
  if (path === '/balances') return handleChannelBalances(request, url, env);
  if (path.match(/^\/channels\/[^/]+\/balance$/)) {
    const parts = path.split('/');
    return handleChannelBalance(request, url, parts[parts.length - 2], env);
  }
  if (path.match(/^\/channels\/[^/]+\/test$/)) {
    const parts = path.split('/');
    return handleChannelTest(request, parts[parts.length - 2], env, requestId);
  }
  if (path.match(/^\/channels\/[^/]+\/delete-impact$/)) {
    const parts = path.split('/');
    return handleChannelDeleteImpact(request, parts[parts.length - 2], env);
  }
  if (path.match(/^\/channels\/[^/]+\/models\/refresh$/)) {
    const parts = path.split('/');
    return request.method === 'POST'
      ? handleChannelModelRefresh(parts[parts.length - 3], env)
      : gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  }
  if (path.match(/^\/channels\/[^/]+\/models\/import$/)) {
    const parts = path.split('/');
    return request.method === 'POST'
      ? handleChannelModelImport(request, parts[parts.length - 3], env)
      : gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  }
  if (path.match(/^\/channels\/[^/]+\/models$/)) {
    const parts = path.split('/');
    return handleChannelProviderModels(request, parts[parts.length - 2], env);
  }
  if (path.match(/^\/channels\/[^/]+$/)) {
    return handleChannelItem(withMethod(request, request.method === 'PATCH' ? 'PUT' : request.method), path.split('/').pop()!, env, requestId);
  }

  if (path === '/models') return handleModelsCollection(request, env, requestId);
  if (path.match(/^\/models\/[^/]+\/instances\/reorder$/)) {
    const parts = path.split('/');
    return handleReorderInstances(request, parts[parts.length - 3], env, requestId);
  }
  if (path.match(/^\/models\/[^/]+\/instances$/)) {
    const parts = path.split('/');
    return handleModelInstances(request, parts[parts.length - 2], env, requestId);
  }
  if (path.match(/^\/models\/[^/]+\/instances\/[^/]+$/)) {
    const parts = path.split('/');
    return handleModelInstanceItem(
      withMethod(request, request.method === 'PATCH' ? 'PUT' : request.method),
      parts[parts.length - 3], parts[parts.length - 1], env, requestId,
    );
  }
  if (path.match(/^\/models\/[^/]+$/)) {
    return handleModelItem(withMethod(request, request.method === 'PATCH' ? 'PUT' : request.method), path.split('/').pop()!, env, requestId);
  }

  if (path === '/gateway-keys') return handleKeysCollection(request, env, requestId);
  if (path.match(/^\/gateway-keys\/[^/]+\/regenerate$/)) {
    const parts = path.split('/');
    return handleKeyRegenerate(request, parts[parts.length - 2], env, requestId);
  }
  if (path.match(/^\/gateway-keys\/[^/]+$/)) {
    return handleKeyItem(withMethod(request, request.method === 'PATCH' ? 'PUT' : request.method), path.split('/').pop()!, env, requestId);
  }

  if (path === '/analytics/usage' && request.method === 'GET') return handleAnalyticsUsage(request, url, env, requestId);
  if (path === '/logs' && request.method === 'GET') return handleAnalyticsLogs(request, url, env, requestId);
  if (path.match(/^\/logs\/[^/]+$/) && request.method === 'GET') {
    const row = await getLogById(env.DB, path.split('/').pop()!);
    if (!row) return gatewayErrorResponse('invalid_request', 'Log entry not found', requestId);
    const {
      context_request_iv: _requestIv,
      context_request_tag: _requestTag,
      context_request_ciphertext: _requestCiphertext,
      context_response_iv: _responseIv,
      context_response_tag: _responseTag,
      context_response_ciphertext: _responseCiphertext,
      ...safe
    } = row;
    return Response.json({ ...safe, context_request: null, context_response: null });
  }
  if (path === '/system/status' && request.method === 'GET') {
    return Response.json({ version: env.APP_VERSION ?? '0.1.0', status: 'ok' });
  }

  return gatewayErrorResponse('invalid_request', 'Management API route not found', requestId);
}

export async function handleManagementApi(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const requestId = generateRequestId();
  if (url.pathname === `${API_PREFIX}/capabilities` && request.method === 'GET') {
    return Response.json(capabilityDocument(env), { headers: { 'x-gateway-request-id': requestId } });
  }
  if (url.pathname === `${API_PREFIX}/openapi.json` && request.method === 'GET') {
    return Response.json(openApiDocument(env), { headers: { 'x-gateway-request-id': requestId } });
  }

  const key = await authenticateManagementKey(request, env.DB);
  if (!key) {
    logAuthFailed(requestId, 'invalid_management_key');
    return gatewayErrorResponse('invalid_api_key', 'Valid Management Key required', requestId);
  }
  if (!['GET', 'HEAD'].includes(request.method) && key.permission !== 'write') {
    const denied = gatewayErrorResponse('insufficient_permission', 'Write permission required', requestId);
    ctx.waitUntil(recordManagementAudit(env.DB, {
      id: generateId(), keyId: key.id, method: request.method,
      path: url.pathname, status: denied.status, requestId,
    }).catch(() => undefined));
    return denied;
  }

  let response: Response;
  try {
    response = await routeManagementResource(request, url, env, requestId);
  } catch {
    response = gatewayErrorResponse('gateway_internal_error', 'Management API request failed', requestId);
  }
  response.headers.set('x-gateway-request-id', requestId);
  ctx.waitUntil(recordManagementAudit(env.DB, {
    id: generateId(), keyId: key.id, method: request.method,
    path: url.pathname, status: response.status, requestId,
  }).catch(() => undefined));
  return response;
}
