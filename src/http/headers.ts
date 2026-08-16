/**
 * Header utilities: upstream whitelist and response headers.
 */

/**
 * Build upstream request headers from scratch (whitelist approach).
 */
export function buildUpstreamHeaders(input: {
  providerApiKey: string;
  requestId: string;
  isStream: boolean;
  appVersion: string;
  authScheme?: 'bearer' | 'x_api_key';
  apiVersion?: string | null;
}): Headers {
  const headers = new Headers();
  if (input.authScheme === 'x_api_key') {
    headers.set('x-api-key', input.providerApiKey);
    headers.set('anthropic-version', input.apiVersion ?? '2023-06-01');
  } else {
    headers.set('Authorization', `Bearer ${input.providerApiKey}`);
  }
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', input.isStream ? 'text/event-stream' : 'application/json');
  headers.set('User-Agent', `mygateway/${input.appVersion}`);
  headers.set('x-gateway-request-id', input.requestId);
  return headers;
}

/**
 * Standard response headers for gateway responses.
 */
export function gatewayResponseHeaders(requestId: string): Headers {
  const headers = new Headers();
  headers.set('x-gateway-request-id', requestId);
  return headers;
}
