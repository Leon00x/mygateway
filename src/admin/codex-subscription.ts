/** Admin endpoints for the experimental ChatGPT/Codex subscription channel. */

import type { Env } from '../env.ts';
import { encryptOAuthSecret, decryptOAuthSecret } from '../crypto/oauth-token.ts';
import {
  cleanupCodexDeviceFlows,
  completeCodexDeviceFlow,
  createCodexConnection,
  createCodexDeviceFlow,
  deleteCodexConnection,
  failCodexDeviceFlow,
  getLatestCodexConnection,
  getCodexDeviceFlow,
  recordCodexDevicePoll,
} from '../db/codex-oauth.ts';
import { createChannel, replaceChannelProtocols } from '../db/channels.ts';
import { generateId } from '../shared/ids.ts';
import {
  CODEX_BACKEND_BASE_URL,
  CODEX_DEVICE_VERIFICATION_URL,
  CodexDevicePendingError,
  exchangeCodexDeviceAuthorization,
  fetchCodexModels,
  fetchCodexUsage,
  pollCodexDeviceAuthorization,
  requestCodexDeviceCode,
  type CodexTokens,
} from '../codex/client.ts';
import { ensureCodexCredential } from '../codex/credentials.ts';
import { invalidateModelRouteCache } from '../gateway/access-resolver.ts';
import { parseProviderModelList, persistDiscoveredProviderModels } from './model-discovery.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function maskEmail(value: string | null): string | null {
  if (!value) return null;
  const [local, domain] = value.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

function publicConnection(connection: Awaited<ReturnType<typeof getLatestCodexConnection>>) {
  if (!connection) return null;
  return {
    id: connection.id,
    email: maskEmail(connection.email),
    plan_type: connection.plan_type,
    expires_at: connection.expires_at,
    status: connection.status,
    created_at: connection.created_at,
  };
}

async function saveConnection(env: Env, tokens: CodexTokens): Promise<{ connectionId: string; channelId: string }> {
  const connectionId = generateId();
  const channelId = generateId();
  const [access, refresh] = await Promise.all([
    encryptOAuthSecret(tokens.accessToken, env.MASTER_KEY, connectionId, 'access', 1),
    encryptOAuthSecret(tokens.refreshToken, env.MASTER_KEY, connectionId, 'refresh', 1),
  ]);
  try {
    await createCodexConnection(env.DB, {
      id: connectionId,
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      token_version: 1,
      account_id: tokens.accountId,
      email: tokens.email,
      plan_type: tokens.planType,
      expires_at: tokens.expiresAt,
      status: 'active',
    });
    await createChannel(env.DB, {
      id: channelId,
      name: 'ChatGPT Codex Subscription',
      provider_type: 'openai',
      base_url: CODEX_BACKEND_BASE_URL,
      api_key_ciphertext: '',
      api_key_iv: '',
      api_key_version: 1,
      auth_type: 'codex_oauth',
      oauth_connection_id: connectionId,
      status: 'active',
      notes: 'Experimental subscription-backed channel',
      preset_id: 'chatgpt_codex',
      short_code: 'codex',
    });
    await replaceChannelProtocols(env.DB, channelId, [{
      protocol: 'openai_responses',
      base_url: CODEX_BACKEND_BASE_URL,
      auth_scheme: 'bearer',
      api_version: null,
    }]);
    try {
      const payload = await fetchCodexModels(tokens.accessToken, tokens.accountId);
      await persistDiscoveredProviderModels(env.DB, channelId, parseProviderModelList(payload).models);
    } catch {
      // Account binding remains valid when this undocumented discovery endpoint
      // is temporarily unavailable; the administrator can retry from Channels.
    }
  } catch (error) {
    await deleteCodexConnection(env.DB, connectionId).catch(() => undefined);
    throw error;
  }
  invalidateModelRouteCache();
  return { connectionId, channelId };
}

export async function handleCodexSubscriptionStatus(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: { message: 'Method not allowed' } }, 405);
  return json({ experimental: true, connection: publicConnection(await getLatestCodexConnection(env.DB)) });
}

export async function handleCodexDeviceStart(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);
  if (await getLatestCodexConnection(env.DB)) {
    return json({ error: { message: 'Disconnect the current ChatGPT account before connecting another one' } }, 409);
  }
  const now = Math.floor(Date.now() / 1000);
  await cleanupCodexDeviceFlows(env.DB, now);
  try {
    const device = await requestCodexDeviceCode();
    const flowId = generateId();
    const encrypted = await encryptOAuthSecret(device.deviceAuthId, env.MASTER_KEY, flowId, 'device', 1);
    await createCodexDeviceFlow(env.DB, {
      id: flowId,
      device_auth_ciphertext: encrypted.ciphertext,
      device_auth_iv: encrypted.iv,
      user_code: device.userCode,
      poll_interval_seconds: device.intervalSeconds,
      expires_at: now + 15 * 60,
      status: 'pending',
    });
    return json({
      flow_id: flowId,
      user_code: device.userCode,
      verification_url: CODEX_DEVICE_VERIFICATION_URL,
      interval_seconds: device.intervalSeconds,
      expires_at: now + 15 * 60,
    }, 201);
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : 'Could not start Codex authorization' } }, 502);
  }
}

export async function handleCodexDevicePoll(
  request: Request,
  flowId: string,
  env: Env,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);
  const flow = await getCodexDeviceFlow(env.DB, flowId);
  if (!flow) return json({ error: { message: 'Authorization flow not found' } }, 404);
  if (flow.status === 'completed') return json({ status: 'completed', connection_id: flow.connection_id });
  if (flow.status === 'failed') return json({ status: 'failed', error: { message: flow.error_summary } }, 409);
  if (flow.status === 'expired') return json({ status: 'expired' }, 410);
  const now = Math.floor(Date.now() / 1000);
  if (flow.expires_at <= now) {
    await failCodexDeviceFlow(env.DB, flow.id, 'expired', 'Authorization expired');
    return json({ status: 'expired' }, 410);
  }
  if (!(await recordCodexDevicePoll(env.DB, flow.id, now))) {
    return json({ status: 'pending', retry_after: flow.poll_interval_seconds }, 202);
  }
  try {
    const deviceAuthId = await decryptOAuthSecret(
      flow.device_auth_ciphertext, flow.device_auth_iv, env.MASTER_KEY, flow.id, 'device', 1,
    );
    const authorization = await pollCodexDeviceAuthorization(deviceAuthId, flow.user_code);
    const tokens = await exchangeCodexDeviceAuthorization(authorization);
    const saved = await saveConnection(env, tokens);
    await completeCodexDeviceFlow(env.DB, flow.id, saved.connectionId);
    return json({ status: 'completed', connection_id: saved.connectionId, channel_id: saved.channelId });
  } catch (error) {
    if (error instanceof CodexDevicePendingError) {
      return json({ status: 'pending', retry_after: flow.poll_interval_seconds }, 202);
    }
    const message = error instanceof Error ? error.message : 'Codex authorization failed';
    await failCodexDeviceFlow(env.DB, flow.id, 'failed', message);
    return json({ status: 'failed', error: { message } }, 502);
  }
}

export async function handleCodexSubscriptionUsage(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: { message: 'Method not allowed' } }, 405);
  const connection = await getLatestCodexConnection(env.DB);
  if (!connection) return json({ error: { message: 'No ChatGPT account is connected' } }, 404);
  try {
    const credential = await ensureCodexCredential(env, connection.id);
    return json({ usage: await fetchCodexUsage(credential.accessToken, credential.accountId) });
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : 'Codex usage query failed' } }, 502);
  }
}

export async function handleCodexSubscriptionModels(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: { message: 'Method not allowed' } }, 405);
  const connection = await getLatestCodexConnection(env.DB);
  if (!connection) return json({ error: { message: 'No ChatGPT account is connected' } }, 404);
  try {
    const credential = await ensureCodexCredential(env, connection.id);
    return json({ models: await fetchCodexModels(credential.accessToken, credential.accountId) });
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : 'Codex model query failed' } }, 502);
  }
}

export async function handleCodexSubscriptionDisconnect(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'DELETE') return json({ error: { message: 'Method not allowed' } }, 405);
  const connection = await getLatestCodexConnection(env.DB);
  if (!connection) return new Response(null, { status: 204 });
  await deleteCodexConnection(env.DB, connection.id);
  invalidateModelRouteCache();
  return new Response(null, { status: 204 });
}
