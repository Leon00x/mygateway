/**
 * Experimental ChatGPT Codex adapter.
 *
 * The device flow mirrors the Apache-2.0 OpenAI Codex client and the request
 * normalization follows the interoperable subset exercised by MIT-licensed
 * CLIProxyAPI. These endpoints are not part of the public OpenAI API contract.
 */

export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_AUTH_BASE_URL = 'https://auth.openai.com';
export const CODEX_DEVICE_VERIFICATION_URL = `${CODEX_AUTH_BASE_URL}/codex/device`;
export const CODEX_BACKEND_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const CODEX_DEVICE_REDIRECT_URI = `${CODEX_AUTH_BASE_URL}/deviceauth/callback`;

const MAX_JSON_BYTES = 1024 * 1024;
const AUTH_TIMEOUT_MS = 20_000;
const QUERY_TIMEOUT_MS = 10_000;
const MAX_AGGREGATED_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface CodexDeviceCode {
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
}

export interface CodexDeviceAuthorization {
  authorizationCode: string;
  codeVerifier: string;
}

export interface CodexTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  expiresAt: number;
  accountId: string;
  email: string | null;
  planType: string | null;
}

export class CodexDevicePendingError extends Error {
  constructor() {
    super('Codex device authorization is pending');
    this.name = 'CodexDevicePendingError';
  }
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new Error(`${operation} response is too large`);
  }
  if (!response.ok) throw new Error(`${operation} failed (HTTP ${response.status})`);
  try { return JSON.parse(text); } catch { throw new Error(`${operation} returned invalid JSON`); }
}

function objectValue(value: unknown, operation: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} returned an invalid response`);
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, names: string[], operation: string): string {
  for (const name of names) {
    if (typeof body[name] === 'string' && body[name].trim()) return body[name].trim();
  }
  throw new Error(`${operation} response is missing ${names[0]}`);
}

export async function requestCodexDeviceCode(fetcher: typeof fetch = fetch): Promise<CodexDeviceCode> {
  const response = await fetcher(`${CODEX_AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });
  const body = objectValue(await readJson(response, 'Codex device authorization'), 'Codex device authorization');
  const interval = Number(body.interval);
  return {
    deviceAuthId: requiredString(body, ['device_auth_id'], 'Codex device authorization'),
    userCode: requiredString(body, ['user_code', 'usercode'], 'Codex device authorization'),
    intervalSeconds: Number.isFinite(interval) && interval > 0 ? Math.max(3, Math.floor(interval)) : 5,
  };
}

export async function pollCodexDeviceAuthorization(
  deviceAuthId: string,
  userCode: string,
  fetcher: typeof fetch = fetch,
): Promise<CodexDeviceAuthorization> {
  const response = await fetcher(`${CODEX_AUTH_BASE_URL}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });
  if (response.status === 403 || response.status === 404) {
    await response.body?.cancel();
    throw new CodexDevicePendingError();
  }
  const body = objectValue(await readJson(response, 'Codex device polling'), 'Codex device polling');
  return {
    authorizationCode: requiredString(body, ['authorization_code'], 'Codex device polling'),
    codeVerifier: requiredString(body, ['code_verifier'], 'Codex device polling'),
  };
}

function decodeJwtClaims(token: string | null): Record<string, unknown> {
  if (!token) return {};
  try {
    const part = token.split('.')[1];
    if (!part) return {};
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return objectValue(JSON.parse(atob(normalized)) as unknown, 'Codex token');
  } catch { return {}; }
}

function nestedString(body: Record<string, unknown>, path: string[]): string | null {
  let value: unknown = body;
  for (const part of path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseTokens(
  value: unknown,
  fallback?: { refreshToken?: string; accountId?: string; email?: string | null; planType?: string | null },
): CodexTokens {
  const body = objectValue(value, 'Codex token exchange');
  const accessToken = requiredString(body, ['access_token'], 'Codex token exchange');
  const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token.trim()
    ? body.refresh_token.trim() : fallback?.refreshToken;
  if (!refreshToken) throw new Error('Codex token exchange response is missing refresh_token');
  const idToken = typeof body.id_token === 'string' ? body.id_token : null;
  const claims = { ...decodeJwtClaims(accessToken), ...decodeJwtClaims(idToken) };
  const auth = nestedString(claims, ['https://api.openai.com/auth', 'chatgpt_account_id']);
  const accountId = auth
    ?? nestedString(claims, ['chatgpt_account_id'])
    ?? fallback?.accountId;
  if (!accountId) throw new Error('Codex token does not contain a ChatGPT account id');
  const expiresIn = Number(body.expires_in);
  return {
    accessToken,
    refreshToken,
    idToken,
    expiresAt: Math.floor(Date.now() / 1000) + (Number.isFinite(expiresIn) && expiresIn > 0 ? Math.floor(expiresIn) : 3600),
    accountId,
    email: nestedString(claims, ['email']) ?? fallback?.email ?? null,
    planType: nestedString(claims, ['https://api.openai.com/auth', 'chatgpt_plan_type'])
      ?? nestedString(claims, ['chatgpt_plan_type']) ?? fallback?.planType ?? null,
  };
}

export async function exchangeCodexDeviceAuthorization(
  authorization: CodexDeviceAuthorization,
  fetcher: typeof fetch = fetch,
): Promise<CodexTokens> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code', client_id: CODEX_CLIENT_ID,
    code: authorization.authorizationCode, redirect_uri: CODEX_DEVICE_REDIRECT_URI,
    code_verifier: authorization.codeVerifier,
  });
  const response = await fetcher(`${CODEX_AUTH_BASE_URL}/oauth/token`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });
  return parseTokens(await readJson(response, 'Codex token exchange'));
}

export async function refreshCodexTokens(
  refreshToken: string,
  fetcher: typeof fetch = fetch,
  identity?: { accountId: string; email: string | null; planType: string | null },
): Promise<CodexTokens> {
  const form = new URLSearchParams({
    client_id: CODEX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken,
    scope: 'openid profile email',
  });
  const response = await fetcher(`${CODEX_AUTH_BASE_URL}/oauth/token`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });
  return parseTokens(await readJson(response, 'Codex token refresh'), { refreshToken, ...identity });
}

export function codexHeaders(
  accessToken: string,
  accountId: string,
  requestId?: string,
  accept: 'sse' | 'json' = 'sse',
): Headers {
  const headers = new Headers({
    Accept: accept === 'sse' ? 'text/event-stream' : 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Chatgpt-Account-Id': accountId,
    'Content-Type': 'application/json',
    Originator: 'codex_cli_rs',
    'User-Agent': 'codex_cli_rs/0.1.0 (mygateway; 0.1.0)',
  });
  if (requestId) headers.set('X-Client-Request-Id', requestId);
  return headers;
}

export function normalizeCodexResponsesRequest(body: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...body, stream: true, store: false };
  if (typeof normalized.instructions !== 'string') normalized.instructions = '';
  for (const field of ['previous_response_id', 'generate', 'prompt_cache_retention', 'safety_identifier', 'stream_options']) {
    delete normalized[field];
  }
  return normalized;
}

export async function fetchCodexModels(
  accessToken: string,
  accountId: string,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetcher(`${CODEX_BACKEND_BASE_URL}/models?client_version=0.1.0`, {
    headers: codexHeaders(accessToken, accountId, undefined, 'json'),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  return readJson(response, 'Codex model discovery');
}

export async function fetchCodexUsage(
  accessToken: string,
  accountId: string,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetcher(CODEX_USAGE_URL, {
    headers: codexHeaders(accessToken, accountId, undefined, 'json'),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  return readJson(response, 'Codex usage query');
}

/** Convert the forced upstream SSE stream into one non-stream Responses object. */
export async function codexSseToJson(response: Response): Promise<Response> {
  if (!response.body) throw new Error('Codex stream returned no response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_AGGREGATED_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Codex non-stream response exceeds the aggregation limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  let completed: unknown;
  let dataLines: string[] = [];
  const processEvent = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n').trim();
    dataLines = [];
    if (!data || data === '[DONE]') return;
    try {
      const event = objectValue(JSON.parse(data) as unknown, 'Codex stream');
      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        completed = event.response ?? event;
      }
    } catch { /* later valid completion events remain usable */ }
  };
  for (const line of text.split(/\r?\n/)) {
    if (line === '') processEvent();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  processEvent();
  if (!completed) throw new Error('Codex stream ended without a completed response');
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json');
  headers.delete('Content-Length');
  return new Response(JSON.stringify(completed), { status: response.status, headers });
}
