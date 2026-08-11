import type { Env } from '../env.ts';
import { Hono } from 'hono';
import { apiReference } from '@scalar/hono-api-reference';
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
const managementDocsApp = new Hono<{ Bindings: Env }>();

managementDocsApp.get(`${API_PREFIX}/api-docs`, apiReference({
  spec: { url: `${API_PREFIX}/openapi.json` },
  pageTitle: 'MyGateway Management API Docs',
}));

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
    docs_url: `${API_PREFIX}/api-docs`,
    openapi_url: `${API_PREFIX}/openapi.json`,
    resources: ['channels', 'models', 'gateway_keys', 'analytics', 'logs', 'balances', 'system'],
  };
}

function openApiDocument(env: Env) {
  const bearer = [{ managementKey: [] }];
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const jsonContent = (schema: Record<string, unknown>) => ({
    'application/json': { schema },
  });
  const operation = (
    summary: string,
    permission: 'read' | 'write',
    options: {
      tag: string;
      operationId: string;
      success?: string;
      successStatus?: '200' | '201' | '204';
      responseSchema?: Record<string, unknown>;
      requestSchema?: Record<string, unknown>;
      parameters?: Array<Record<string, unknown>>;
      description?: string;
    },
  ) => ({
    summary,
    description: options.description,
    tags: [options.tag],
    operationId: options.operationId,
    security: bearer,
    'x-required-permission': permission,
    parameters: options.parameters,
    requestBody: options.requestSchema ? {
      required: true,
      content: jsonContent(options.requestSchema),
    } : undefined,
    responses: {
      [options.successStatus ?? '200']: {
        description: options.success ?? 'Success',
        ...(options.responseSchema ? { content: jsonContent(options.responseSchema) } : {}),
      },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '403': { $ref: '#/components/responses/Forbidden' },
      '409': { $ref: '#/components/responses/Conflict' },
    },
  });
  const idParameter = (name = 'id', description = 'Resource ID') => ({
    name, in: 'path', required: true, description, schema: { type: 'string' },
  });
  const queryParameter = (
    name: string,
    schema: Record<string, unknown>,
    description?: string,
    required = false,
  ) => ({ name, in: 'query', required, description, schema });
  const channelInput = {
    type: 'object',
    required: ['api_key'],
    properties: {
      preset_id: { type: 'string', description: 'Optional provider preset ID.' },
      name: { type: 'string' },
      provider_type: { type: 'string', enum: ['openai', 'openai_compatible'] },
      base_url: { type: 'string', format: 'uri' },
      api_key: { type: 'string', writeOnly: true, description: 'Provider credential. Accepted on writes and never returned.' },
      notes: { type: ['string', 'null'] },
      protocols: { type: 'array', minItems: 1, items: ref('ChannelProtocol') },
      detected_models: { type: 'array', maxItems: 500, items: ref('DetectedModel') },
    },
    examples: [{
      name: 'Example Provider', provider_type: 'openai_compatible', base_url: 'https://api.example.com/v1',
      api_key: 'provider-secret',
      protocols: [{ protocol: 'openai_chat', base_url: 'https://api.example.com/v1', auth_scheme: 'bearer' }],
    }],
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'MyGateway Management API',
      version: 'v1',
      description: 'Stable, scoped API for managing common MyGateway resources. Provider credentials are never returned.',
    },
    servers: [{ url: API_PREFIX }],
    tags: [
      { name: 'Discovery', description: 'Public discovery and documentation endpoints.' },
      { name: 'Channels', description: 'Provider connections. Provider credentials are write-only.' },
      { name: 'Models', description: 'Unified models, channel instances, and fallback order.' },
      { name: 'Gateway Keys', description: 'Client credentials for the data-plane APIs.' },
      { name: 'Observability', description: 'Usage, request metadata, and provider balances.' },
      { name: 'System', description: 'Deployment status.' },
    ],
    components: {
      securitySchemes: { managementKey: { type: 'http', scheme: 'bearer', bearerFormat: 'mgmt_...' } },
      responses: {
        BadRequest: { description: 'Invalid request', content: jsonContent(ref('Error')) },
        Unauthorized: { description: 'Missing, invalid, expired, disabled, or deleted Management Key', content: jsonContent(ref('Error')) },
        Forbidden: { description: 'The Management Key does not have write permission', content: jsonContent(ref('Error')) },
        Conflict: { description: 'Resource already exists or is in use', content: jsonContent(ref('Error')) },
      },
      schemas: {
        Error: {
          type: 'object', required: ['error'],
          properties: { error: { type: 'object', required: ['message', 'type', 'code'], properties: {
            message: { type: 'string' }, type: { type: 'string', example: 'gateway_error' },
            param: { type: ['string', 'null'] }, code: { type: 'string', example: 'invalid_request' },
          } } },
        },
        ChannelProtocol: {
          type: 'object', required: ['protocol', 'base_url', 'auth_scheme'],
          properties: {
            protocol: { type: 'string', enum: ['openai_chat', 'openai_responses', 'anthropic_messages'] },
            base_url: { type: 'string', format: 'uri' },
            auth_scheme: { type: 'string', enum: ['bearer', 'x_api_key'] },
            api_version: { type: ['string', 'null'], description: 'Anthropic API version when applicable.' },
          },
        },
        DetectedModel: {
          type: 'object', required: ['provider_model_id'],
          properties: { provider_model_id: { type: 'string' }, display_name: { type: 'string' }, capabilities: {} },
        },
        Channel: {
          type: 'object', description: 'Public channel representation. It never contains Provider Key material.',
          required: ['id', 'name', 'provider_type', 'base_url', 'has_api_key', 'status', 'protocols'],
          properties: {
            id: { type: 'string' }, name: { type: 'string' },
            provider_type: { type: 'string', enum: ['openai', 'openai_compatible'] },
            base_url: { type: 'string', format: 'uri' }, has_api_key: { type: 'boolean' },
            status: { type: 'string', enum: ['active', 'disabled'] }, notes: { type: ['string', 'null'] },
            preset_id: { type: ['string', 'null'] }, short_code: { type: ['string', 'null'] },
            protocols: { type: 'array', items: ref('ChannelProtocol') },
            created_at: { type: 'integer' }, updated_at: { type: 'integer' },
          }, additionalProperties: true,
        },
        ChannelUpdate: {
          type: 'object', minProperties: 1,
          properties: {
            name: { type: 'string' }, base_url: { type: 'string', format: 'uri' },
            api_key: { type: 'string', writeOnly: true }, status: { type: 'string', enum: ['active', 'disabled'] },
            notes: { type: ['string', 'null'] }, protocols: { type: 'array', minItems: 1, items: ref('ChannelProtocol') },
          },
        },
        UnifiedModelInput: {
          type: 'object', required: ['unified_model_id', 'display_name'],
          properties: {
            unified_model_id: { type: 'string', example: 'support' }, display_name: { type: 'string', example: 'Support' },
            channel_id: { type: 'string' }, channel_model_id: { type: 'string' },
          },
        },
        UnifiedModel: {
          type: 'object', required: ['id', 'unified_model_id', 'display_name', 'instances'],
          properties: {
            id: { type: 'string' }, unified_model_id: { type: 'string' }, display_name: { type: 'string' },
            status: { type: 'string' }, instances: { type: 'array', items: ref('ModelInstance') },
          }, additionalProperties: true,
        },
        ModelInstance: {
          type: 'object', properties: {
            id: { type: 'string' }, channel_id: { type: 'string' }, channel_model_id: { type: 'string' },
            public_model_alias: { type: 'string' }, sort_order: { type: 'integer' }, status: { type: 'string' },
            supports_stream_usage: { type: ['boolean', 'integer'] },
            input_price_micros_per_million: { type: ['integer', 'null'], minimum: 0 },
            output_price_micros_per_million: { type: ['integer', 'null'], minimum: 0 },
            cache_input_price_micros_per_million: { type: ['integer', 'null'], minimum: 0 },
            currency: { type: ['string', 'null'], enum: ['USD', 'CNY', null] },
          }, additionalProperties: true,
        },
        ModelInstanceInput: {
          type: 'object', required: ['channel_id', 'channel_model_id', 'public_model_alias'],
          properties: {
            channel_id: { type: 'string' }, channel_model_id: { type: 'string' }, public_model_alias: { type: 'string' },
            sort_order: { type: 'integer', minimum: 0 }, supports_stream_usage: { type: 'boolean' },
            input_price_micros_per_million: { type: ['integer', 'null'], minimum: 0 },
            output_price_micros_per_million: { type: ['integer', 'null'], minimum: 0 },
            cache_input_price_micros_per_million: { type: ['integer', 'null'], minimum: 0 },
          },
        },
        GatewayKeyInput: {
          type: 'object', required: ['name'], properties: {
            name: { type: 'string' }, rpm_limit: { type: ['integer', 'null'], minimum: 0 },
            daily_request_limit: { type: ['integer', 'null'], minimum: 0 }, daily_token_limit: { type: ['integer', 'null'], minimum: 0 },
            expires_at: { type: ['integer', 'null'], description: 'Future Unix seconds; null means permanent.' },
            model_allowlist: { type: 'array', items: { type: 'string' } }, temporary: { type: 'boolean', default: false },
          },
        },
        GatewayKey: {
          type: 'object', description: 'Plaintext key is absent from list/update responses.',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, key_prefix: { type: 'string' }, status: { type: 'string' },
            expires_at: { type: ['integer', 'null'] }, model_allowlist: { type: 'array', items: { type: 'string' } },
            is_temporary: { type: ['boolean', 'integer'] },
          }, additionalProperties: true,
        },
        GatewayKeyUpdate: {
          type: 'object', minProperties: 1, properties: {
            name: { type: 'string' }, status: { type: 'string', enum: ['active', 'disabled'] },
            rpm_limit: { type: ['integer', 'null'], minimum: 0 },
            daily_request_limit: { type: ['integer', 'null'], minimum: 0 },
            daily_token_limit: { type: ['integer', 'null'], minimum: 0 },
            expires_at: { type: ['integer', 'null'], description: 'Future Unix seconds; null means permanent.' },
            model_allowlist: { type: 'array', items: { type: 'string' } },
          },
        },
        GatewayKeyCreated: {
          allOf: [ref('GatewayKey'), { type: 'object', required: ['key'], properties: {
            key: { type: 'string', readOnly: true, description: 'One-time plaintext Gateway Key.' },
          } }],
        },
        Usage: {
          type: 'object', required: ['range', 'summary', 'models', 'trends'],
          properties: {
            range: { type: 'object', properties: { start: { type: 'integer' }, end: { type: 'integer' } } },
            summary: { type: 'object', additionalProperties: true }, models: { type: 'array', items: { type: 'object', additionalProperties: true } },
            trends: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        RequestLog: {
          type: 'object', description: 'Request metadata only. Prompt/response context and crypto fields are never exposed.',
          properties: {
            id: { type: 'string' }, request_id: { type: 'string' }, timestamp: { type: 'integer' },
            status: { type: 'string' }, unified_model_id: { type: ['string', 'null'] }, channel_id: { type: ['string', 'null'] },
            input_tokens: { type: ['integer', 'null'] }, output_tokens: { type: ['integer', 'null'] },
            latency_ms: { type: ['integer', 'null'] }, ttft_ms: { type: ['integer', 'null'] },
            context_request: { type: 'null' }, context_response: { type: 'null' },
          }, additionalProperties: true,
        },
      },
    },
    paths: {
      '/capabilities': { get: { tags: ['Discovery'], operationId: 'getCapabilities', summary: 'Discover API capabilities', security: [], responses: { '200': { description: 'Capabilities', content: jsonContent({ type: 'object', additionalProperties: true }) } } } },
      '/openapi.json': { get: { tags: ['Discovery'], operationId: 'getOpenApi', summary: 'Read this OpenAPI document', security: [], responses: { '200': { description: 'OpenAPI 3.1 document' } } } },
      '/api-docs': { get: { tags: ['Discovery'], operationId: 'getApiDocs', summary: 'Open interactive API reference', security: [], responses: { '200': { description: 'Scalar HTML documentation', content: { 'text/html': { schema: { type: 'string' } } } } } } },
      '/channels/preflight': { post: operation('Test channel configuration and discover models without saving', 'write', { tag: 'Channels', operationId: 'preflightChannel', requestSchema: channelInput, responseSchema: { type: 'object', additionalProperties: true } }) },
      '/channels': {
        get: operation('List channels without Provider Keys', 'read', { tag: 'Channels', operationId: 'listChannels', responseSchema: { type: 'array', items: ref('Channel') } }),
        post: operation('Create a channel', 'write', { tag: 'Channels', operationId: 'createChannel', success: 'Created; Provider Key is never returned', successStatus: '201', requestSchema: channelInput, responseSchema: ref('Channel') }),
      },
      '/channels/{id}': {
        get: operation('Read a channel without its Provider Key', 'read', { tag: 'Channels', operationId: 'getChannel', parameters: [idParameter()], responseSchema: ref('Channel') }),
        patch: operation('Update a channel or rotate its Provider Key', 'write', { tag: 'Channels', operationId: 'updateChannel', parameters: [idParameter()], requestSchema: ref('ChannelUpdate'), responseSchema: ref('Channel') }),
        delete: operation('Delete a channel', 'write', { tag: 'Channels', operationId: 'deleteChannel', parameters: [idParameter()], success: 'No content', successStatus: '204' }),
      },
      '/channels/{id}/test': { post: operation('Test a saved channel connection', 'write', { tag: 'Channels', operationId: 'testChannel', parameters: [idParameter()], responseSchema: { type: 'object', additionalProperties: true } }) },
      '/channels/{id}/delete-impact': { get: operation('Inspect channel deletion impact', 'read', { tag: 'Channels', operationId: 'getChannelDeleteImpact', parameters: [idParameter()], responseSchema: { type: 'object', additionalProperties: true } }) },
      '/channels/{id}/balance': { get: operation('Read or refresh one provider balance', 'read', { tag: 'Observability', operationId: 'getChannelBalance', parameters: [idParameter(), queryParameter('refresh', { type: 'integer', enum: [0, 1] })], responseSchema: { type: 'object', additionalProperties: true } }) },
      '/channels/{id}/models': {
        get: operation('List provider-model inventory', 'read', { tag: 'Channels', operationId: 'listChannelModels', parameters: [idParameter()], responseSchema: { type: 'object', additionalProperties: true } }),
        post: operation('Add a provider model to inventory', 'write', { tag: 'Channels', operationId: 'addChannelModel', parameters: [idParameter()], requestSchema: { type: 'object', required: ['model_id'], properties: { model_id: { type: 'string' }, display_name: { type: 'string' } } }, responseSchema: { type: 'object', additionalProperties: true }, successStatus: '201' }),
        delete: operation('Remove a provider model from inventory', 'write', { tag: 'Channels', operationId: 'deleteChannelModel', parameters: [idParameter(), queryParameter('model_id', { type: 'string' }, 'Provider model ID', true)], success: 'No content', successStatus: '204' }),
      },
      '/channels/{id}/models/refresh': { post: operation('Refresh provider-model inventory', 'write', { tag: 'Channels', operationId: 'refreshChannelModels', parameters: [idParameter()], responseSchema: { type: 'object', additionalProperties: true } }) },
      '/channels/{id}/models/import': { post: operation('Import inventory models into unified models', 'write', { tag: 'Channels', operationId: 'importChannelModels', parameters: [idParameter()], requestSchema: { type: 'object', required: ['models'], properties: { models: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['provider_model_id'], properties: { provider_model_id: { type: 'string' }, unified_model_id: { type: 'string' } } } }, prices: { type: 'object', additionalProperties: true } } }, responseSchema: { type: 'object', additionalProperties: true } }) },
      '/balances': { get: operation('Read or refresh supported provider balances', 'read', { tag: 'Observability', operationId: 'listBalances', parameters: [queryParameter('refresh', { type: 'integer', enum: [0, 1] }), queryParameter('active', { type: 'integer', enum: [0, 1] })], responseSchema: { type: 'object', additionalProperties: true } }) },
      '/models': {
        get: operation('List unified models and instances', 'read', { tag: 'Models', operationId: 'listModels', responseSchema: { type: 'array', items: ref('UnifiedModel') } }),
        post: operation('Create a unified model', 'write', { tag: 'Models', operationId: 'createModel', successStatus: '201', success: 'Created', requestSchema: ref('UnifiedModelInput'), responseSchema: ref('UnifiedModel') }),
      },
      '/models/{id}': {
        get: operation('Read a unified model and its instances', 'read', { tag: 'Models', operationId: 'getModel', parameters: [idParameter()], responseSchema: ref('UnifiedModel') }),
        patch: operation('Update a unified model', 'write', { tag: 'Models', operationId: 'updateModel', parameters: [idParameter()], requestSchema: { type: 'object', minProperties: 1, properties: { display_name: { type: 'string' }, status: { type: 'string' } } }, responseSchema: ref('UnifiedModel') }),
        delete: operation('Delete a unified model and its instances', 'write', { tag: 'Models', operationId: 'deleteModel', parameters: [idParameter()], success: 'No content', successStatus: '204' }),
      },
      '/models/{id}/instances': { post: operation('Add a channel instance', 'write', { tag: 'Models', operationId: 'createModelInstance', parameters: [idParameter()], successStatus: '201', success: 'Created', requestSchema: ref('ModelInstanceInput'), responseSchema: ref('UnifiedModel') }) },
      '/models/{id}/instances/{instanceId}': { patch: operation('Update instance pricing and stream metadata', 'write', { tag: 'Models', operationId: 'updateModelInstance', parameters: [idParameter(), idParameter('instanceId', 'Model instance ID')], requestSchema: { type: 'object', minProperties: 1, properties: { input_price_micros_per_million: { type: ['integer', 'null'], minimum: 0 }, output_price_micros_per_million: { type: ['integer', 'null'], minimum: 0 }, cache_input_price_micros_per_million: { type: ['integer', 'null'], minimum: 0 }, currency: { type: 'string', enum: ['USD', 'CNY'] }, supports_stream_usage: { type: 'boolean' } } }, responseSchema: ref('UnifiedModel') }) },
      '/models/{id}/instances/reorder': { put: operation('Set fallback order', 'write', { tag: 'Models', operationId: 'reorderModelInstances', parameters: [idParameter()], requestSchema: { type: 'object', required: ['instance_ids'], properties: { instance_ids: { type: 'array', items: { type: 'string' } } } }, responseSchema: ref('UnifiedModel') }) },
      '/gateway-keys': {
        get: operation('List Gateway Keys without plaintext secrets', 'read', { tag: 'Gateway Keys', operationId: 'listGatewayKeys', responseSchema: { type: 'array', items: ref('GatewayKey') } }),
        post: operation('Create a Gateway Key', 'write', { tag: 'Gateway Keys', operationId: 'createGatewayKey', successStatus: '201', success: 'Created; plaintext returned once', requestSchema: ref('GatewayKeyInput'), responseSchema: ref('GatewayKeyCreated') }),
      },
      '/gateway-keys/{id}': {
        patch: operation('Update a Gateway Key', 'write', { tag: 'Gateway Keys', operationId: 'updateGatewayKey', parameters: [idParameter()], requestSchema: ref('GatewayKeyUpdate'), responseSchema: ref('GatewayKey') }),
        delete: operation('Delete a Gateway Key', 'write', { tag: 'Gateway Keys', operationId: 'deleteGatewayKey', parameters: [idParameter()], success: 'No content', successStatus: '204' }),
      },
      '/gateway-keys/{id}/regenerate': { post: operation('Regenerate a Gateway Key', 'write', { tag: 'Gateway Keys', operationId: 'regenerateGatewayKey', parameters: [idParameter()], success: 'Plaintext returned once', responseSchema: ref('GatewayKeyCreated') }) },
      '/analytics/usage': { get: operation('Query usage analytics', 'read', { tag: 'Observability', operationId: 'getUsage', parameters: [queryParameter('range', { type: 'string', enum: ['today', 'yesterday', '7d', '30d', 'custom'] }), queryParameter('start', { type: 'integer' }, 'Custom range start, Unix seconds'), queryParameter('end', { type: 'integer' }, 'Custom range end, Unix seconds'), queryParameter('model_id', { type: 'string' }), queryParameter('key_id', { type: 'string' }), queryParameter('granularity', { type: 'string', enum: ['hour', 'day'] })], responseSchema: ref('Usage') }) },
      '/logs': { get: operation('List request metadata logs without context', 'read', { tag: 'Observability', operationId: 'listLogs', parameters: [queryParameter('start', { type: 'integer' }), queryParameter('end', { type: 'integer' }), queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100 }), queryParameter('cursor_ts', { type: 'integer' }), queryParameter('cursor_id', { type: 'string' }), queryParameter('model_id', { type: 'string' }), queryParameter('key_id', { type: 'string' }), queryParameter('channel_id', { type: 'string' }), queryParameter('status', { type: 'string', enum: ['success', 'error', 'cancelled', 'rate_limited', 'budget_exceeded', 'not_allowed', 'expired'] }), queryParameter('request_id', { type: 'string' }), queryParameter('export', { type: 'integer', enum: [0, 1] }, 'Set to 1 for metadata-only CSV export')], responseSchema: { type: 'object', properties: { logs: { type: 'array', items: ref('RequestLog') }, next_cursor: { type: ['object', 'null'], additionalProperties: true } } } }) },
      '/logs/{id}': { get: operation('Read request metadata without stored context', 'read', { tag: 'Observability', operationId: 'getLog', parameters: [idParameter()], responseSchema: ref('RequestLog') }) },
      '/system/status': {
        get: operation('Read gateway status', 'read', {
          tag: 'System', operationId: 'getSystemStatus',
          responseSchema: {
            type: 'object', required: ['version', 'status'],
            properties: { version: { type: 'string' }, status: { type: 'string', enum: ['ok'] } },
          },
        }),
      },
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
  if (url.pathname === `${API_PREFIX}/api-docs` && request.method === 'GET') {
    return managementDocsApp.fetch(request, env, ctx);
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
