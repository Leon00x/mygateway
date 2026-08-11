import { describe, expect, test, vi } from 'vitest';
import {
  CodexDevicePendingError,
  codexHeaders,
  codexSseToJson,
  exchangeCodexDeviceAuthorization,
  normalizeCodexResponsesRequest,
  pollCodexDeviceAuthorization,
  refreshCodexTokens,
  requestCodexDeviceCode,
} from '../src/codex/client.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../src/crypto/oauth-token.ts';
import { parseProviderModelList } from '../src/admin/model-discovery.ts';

function fetchMock(response: Response) {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

function jwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${encoded}.signature`;
}

describe('experimental Codex client', () => {
  test('starts device authorization with the public Codex client id', async () => {
    const fetcher = fetchMock(new Response(JSON.stringify({
      device_auth_id: 'device-1', user_code: 'ABCD-EFGH', interval: '7',
    }), { status: 200 }));
    await expect(requestCodexDeviceCode(fetcher)).resolves.toEqual({
      deviceAuthId: 'device-1', userCode: 'ABCD-EFGH', intervalSeconds: 7,
    });
    const init = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' });
  });

  test('treats the documented device polling statuses as pending', async () => {
    await expect(pollCodexDeviceAuthorization(
      'device-1', 'ABCD-EFGH', fetchMock(new Response('', { status: 403 })),
    )).rejects.toBeInstanceOf(CodexDevicePendingError);
  });

  test('exchanges and refreshes rotating OAuth tokens', async () => {
    const claims = {
      email: 'person@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-1', chatgpt_plan_type: 'plus',
      },
    };
    const exchangeFetcher = fetchMock(new Response(JSON.stringify({
      access_token: jwt(claims), refresh_token: 'refresh-1', id_token: jwt(claims), expires_in: 3600,
    }), { status: 200 }));
    const exchanged = await exchangeCodexDeviceAuthorization({
      authorizationCode: 'code-1', codeVerifier: 'verifier-1',
    }, exchangeFetcher);
    expect(exchanged).toMatchObject({
      refreshToken: 'refresh-1', accountId: 'acct-1', email: 'person@example.com', planType: 'plus',
    });
    const exchangeInit = (exchangeFetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(String(exchangeInit.body)).toContain('redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback');

    const refreshFetcher = fetchMock(new Response(JSON.stringify({
      access_token: jwt(claims), expires_in: 1800,
    }), { status: 200 }));
    await expect(refreshCodexTokens('refresh-1', refreshFetcher)).resolves.toMatchObject({ refreshToken: 'refresh-1' });
  });

  test('normalizes the subset accepted by the Codex Responses backend', () => {
    expect(normalizeCodexResponsesRequest({
      model: 'codex-model', input: 'hello', previous_response_id: 'old',
      safety_identifier: 'client', stream: false,
    })).toEqual({
      model: 'codex-model', input: 'hello', instructions: '', stream: true, store: false,
    });
  });

  test('builds account-scoped upstream headers without exposing a gateway key', () => {
    const headers = codexHeaders('access-1', 'acct-1', 'request-1');
    expect(headers.get('Authorization')).toBe('Bearer access-1');
    expect(headers.get('Chatgpt-Account-Id')).toBe('acct-1');
    expect(headers.get('Originator')).toBe('codex_cli_rs');
    expect(headers.get('X-Client-Request-Id')).toBe('request-1');
  });

  test('aggregates a forced upstream SSE response for non-stream clients', async () => {
    const response = new Response([
      'data: {"type":"response.created","response":{"id":"resp-1"}}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp-1","object":"response","output":[]}}',
      '',
    ].join('\n'), { headers: { 'Content-Type': 'text/event-stream' } });
    const normalized = await codexSseToJson(response);
    expect(normalized.headers.get('Content-Type')).toBe('application/json');
    await expect(normalized.json()).resolves.toMatchObject({ id: 'resp-1', object: 'response' });
  });

  test('discovers the slug shape returned by the Codex model catalog', () => {
    expect(parseProviderModelList({ models: [
      { slug: 'gpt-codex', display_name: 'GPT Codex' },
      { slug: 'gpt-codex-mini' },
    ] }).models.map((model) => model.id)).toEqual(['gpt-codex', 'gpt-codex-mini']);
  });

  test('OAuth secrets use record, purpose and version-bound authenticated encryption', async () => {
    const master = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const encrypted = await encryptOAuthSecret('secret', master, 'connection-1', 'access', 1);
    await expect(decryptOAuthSecret(
      encrypted.ciphertext, encrypted.iv, master, 'connection-1', 'access', 1,
    )).resolves.toBe('secret');
    await expect(decryptOAuthSecret(
      encrypted.ciphertext, encrypted.iv, master, 'connection-1', 'refresh', 1,
    )).rejects.toThrow();
  });
});
