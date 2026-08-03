/**
 * OpenAI-style error response helpers.
 */

export interface GatewayErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string;
  };
}

export type ErrorCode =
  | 'invalid_request'
  | 'invalid_api_key'
  | 'model_not_found'
  | 'resource_in_use'
  | 'request_too_large'
  | 'gateway_rate_limited'
  | 'model_unavailable'
  | 'upstream_error'
  | 'upstream_timeout'
  | 'gateway_internal_error'
  | 'config_error';

const HTTP_MAP: Record<ErrorCode, number> = {
  invalid_request: 400,
  invalid_api_key: 401,
  model_not_found: 404,
  resource_in_use: 409,
  request_too_large: 413,
  gateway_rate_limited: 429,
  model_unavailable: 503,
  upstream_error: 502,
  upstream_timeout: 504,
  gateway_internal_error: 500,
  config_error: 500,
};

export function gatewayError(
  code: ErrorCode,
  message: string,
  param: string | null = null,
): GatewayErrorBody {
  return {
    error: { message, type: 'gateway_error', param, code },
  };
}

export function gatewayErrorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  param: string | null = null,
): Response {
  const status = HTTP_MAP[code];
  return new Response(JSON.stringify(gatewayError(code, message, param)), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'x-gateway-request-id': requestId,
    },
  });
}
