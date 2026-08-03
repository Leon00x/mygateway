/**
 * Admin channels API handlers.
 */

import { Env } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { generateId, nowSeconds } from '../shared/ids.ts';
import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  softDeleteChannel,
  softDeleteInstancesByChannel,
  isChannelReferenced,
  toPublicChannel,
  ChannelRow,
} from '../db/channels.ts';
import { encryptProviderKey } from '../crypto/provider-key.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Validate and normalize a base URL.
 */
function normalizeBaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed');
  if (parsed.username || parsed.password) throw new Error('URL must not contain credentials');
  if (parsed.search) throw new Error('URL must not contain query parameters');
  if (parsed.hash) throw new Error('URL must not contain fragment');
  // Remove trailing slash
  return parsed.href.replace(/\/+$/, '');
}

/**
 * GET/POST /admin/api/channels
 */
export async function handleChannelsCollection(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const channels = await listChannels(env.DB);
    return json(channels.map(toPublicChannel));
  }

  if (request.method === 'POST') {
    try {
      const body = (await request.json()) as {
        name?: string;
        provider_type?: string;
        base_url?: string;
        api_key?: string;
        notes?: string;
      };

      if (!body.name || !body.provider_type || !body.base_url || !body.api_key) {
        return gatewayErrorResponse('invalid_request', 'name, provider_type, base_url, and api_key are required', requestId);
      }

      if (!['openai', 'openai_compatible'].includes(body.provider_type)) {
        return gatewayErrorResponse('invalid_request', 'provider_type must be openai or openai_compatible', requestId);
      }

      let baseUrl: string;
      try {
        baseUrl = normalizeBaseUrl(body.base_url);
      } catch (e) {
        return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
      }

      const id = generateId();
      const { ciphertext, iv } = await encryptProviderKey(
        body.api_key,
        env.MASTER_KEY,
        id,
        1,
      );

      await createChannel(env.DB, {
        id,
        name: body.name,
        provider_type: body.provider_type as 'openai' | 'openai_compatible',
        base_url: baseUrl,
        api_key_ciphertext: ciphertext,
        api_key_iv: iv,
        api_key_version: 1,
        status: 'active',
        notes: body.notes ?? null,
      });

      const channel = await getChannel(env.DB, id);
      return json(toPublicChannel(channel!), 201);
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}

/**
 * GET/PUT/DELETE /admin/api/channels/:id
 */
export async function handleChannelItem(
  request: Request,
  id: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const channel = await getChannel(env.DB, id);
    if (!channel) return gatewayErrorResponse('model_not_found', 'Channel not found', requestId);
    return json(toPublicChannel(channel));
  }

  if (request.method === 'PUT') {
    try {
      const body = (await request.json()) as {
        name?: string;
        base_url?: string;
        api_key?: string;
        status?: string;
        notes?: string;
      };

      const channel = await getChannel(env.DB, id);
      if (!channel) return gatewayErrorResponse('model_not_found', 'Channel not found', requestId);

      const updates: Parameters<typeof updateChannel>[2] = {};

      if (body.name !== undefined) updates.name = body.name;
      if (body.status !== undefined) {
        if (!['active', 'disabled'].includes(body.status)) {
          return gatewayErrorResponse('invalid_request', 'Invalid status', requestId);
        }
        updates.status = body.status;
      }
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.base_url !== undefined) {
        try {
          updates.base_url = normalizeBaseUrl(body.base_url);
        } catch (e) {
          return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
        }
      }
      if (body.api_key !== undefined) {
        const { ciphertext, iv } = await encryptProviderKey(
          body.api_key,
          env.MASTER_KEY,
          id,
          channel.api_key_version,
        );
        updates.api_key_ciphertext = ciphertext;
        updates.api_key_iv = iv;
      }

      await updateChannel(env.DB, id, updates);
      const updated = await getChannel(env.DB, id);
      return json(toPublicChannel(updated!));
    } catch (e) {
      return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
    }
  }

  if (request.method === 'DELETE') {
    // Cascade: soft-delete all model instances referencing this channel
    await softDeleteInstancesByChannel(env.DB, id);
    await softDeleteChannel(env.DB, id);
    return new Response(null, { status: 204 });
  }

  return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
}

/**
 * POST /admin/api/channels/:id/test
 */
export async function handleChannelTest(
  request: Request,
  channelId: string,
  env: Env,
  requestId: string,
): Promise<Response> {
  const channel = await getChannel(env.DB, channelId);
  if (!channel) return gatewayErrorResponse('model_not_found', 'Channel not found', requestId);

  // Decrypt provider key
  const { decryptProviderKey } = await import('../crypto/provider-key.ts');
  let providerKey: string;
  try {
    providerKey = await decryptProviderKey(
      channel.api_key_ciphertext,
      channel.api_key_iv,
      env.MASTER_KEY,
      channelId,
      channel.api_key_version,
    );
  } catch {
    return json({ ok: false, error: 'Failed to decrypt provider key' }, 500);
  }

  // Test by calling <base_url>/models
  const testUrl = `${channel.base_url}/models`;
  const start = Date.now();

  try {
    const resp = await fetch(testUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${providerKey}`,
        'User-Agent': 'mygateway/0.1.0',
      },
      signal: AbortSignal.timeout(10_000),
    });

    const elapsed = Date.now() - start;

    if (resp.ok) {
      return json({ ok: true, status: resp.status, elapsed_ms: elapsed });
    }
    return json({
      ok: false,
      status: resp.status,
      elapsed_ms: elapsed,
      error: `HTTP ${resp.status}`,
    });
  } catch (e) {
    const elapsed = Date.now() - start;
    return json({ ok: false, elapsed_ms: elapsed, error: (e as Error).message });
  }
}
