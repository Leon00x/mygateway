/** Channel and native protocol endpoint database operations. */

import type { ChannelProtocol, GatewayProtocol, ProtocolAuthScheme } from '../gateway/protocols.ts';

export interface ChannelRow {
  id: string;
  name: string;
  provider_type: 'openai' | 'openai_compatible';
  base_url: string;
  api_key_ciphertext: string;
  api_key_iv: string;
  api_key_version: number;
  status: 'active' | 'disabled';
  notes: string | null;
  created_at: number;
  updated_at: number;
}

/** Channel as returned to admin API (no key material). */
export interface ChannelPublic {
  id: string;
  name: string;
  provider_type: 'openai' | 'openai_compatible';
  base_url: string;
  has_api_key: boolean;
  status: 'active' | 'disabled';
  notes: string | null;
  created_at: number;
  updated_at: number;
  protocols: ChannelProtocol[];
}

export interface ChannelWithProtocols extends ChannelRow {
  protocols: ChannelProtocol[];
}

export function toPublicChannel(row: ChannelWithProtocols): ChannelPublic {
  return {
    id: row.id,
    name: row.name,
    provider_type: row.provider_type,
    base_url: row.base_url,
    has_api_key: true,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    protocols: row.protocols,
  };
}

async function getProtocolMap(db: D1Database, channelIds: string[]): Promise<Map<string, ChannelProtocol[]>> {
  if (channelIds.length === 0) return new Map();
  const placeholders = channelIds.map(() => '?').join(', ');
  const result = await db
    .prepare(`SELECT channel_id, protocol, base_url, auth_scheme, api_version
      FROM channel_protocols WHERE channel_id IN (${placeholders}) ORDER BY protocol ASC`)
    .bind(...channelIds)
    .all<ChannelProtocol & { channel_id: string }>();
  const map = new Map<string, ChannelProtocol[]>();
  for (const row of result.results) {
    const entries = map.get(row.channel_id) ?? [];
    entries.push({
      protocol: row.protocol,
      base_url: row.base_url,
      auth_scheme: row.auth_scheme,
      api_version: row.api_version,
    });
    map.set(row.channel_id, entries);
  }
  return map;
}

export async function listChannels(db: D1Database): Promise<ChannelWithProtocols[]> {
  const result = await db
    .prepare('SELECT * FROM channels WHERE deleted_at IS NULL ORDER BY created_at DESC')
    .all<ChannelRow>();
  const protocolMap = await getProtocolMap(db, result.results.map((row) => row.id));
  return result.results.map((row) => ({ ...row, protocols: protocolMap.get(row.id) ?? [] }));
}

export async function getChannel(db: D1Database, id: string): Promise<ChannelWithProtocols | null> {
  const row = await db
    .prepare('SELECT * FROM channels WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<ChannelRow>();
  if (!row) return null;
  const protocolMap = await getProtocolMap(db, [id]);
  return { ...row, protocols: protocolMap.get(id) ?? [] };
}

export async function createChannel(
  db: D1Database,
  channel: Omit<ChannelRow, 'created_at' | 'updated_at'>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO channels (id, name, provider_type, base_url, api_key_ciphertext, api_key_iv, api_key_version, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      channel.id,
      channel.name,
      channel.provider_type,
      channel.base_url,
      channel.api_key_ciphertext,
      channel.api_key_iv,
      channel.api_key_version,
      channel.status,
      channel.notes,
    )
    .run();
}

export interface ChannelProtocolInput {
  protocol: GatewayProtocol;
  base_url: string;
  auth_scheme: ProtocolAuthScheme;
  api_version?: string | null;
}

export async function replaceChannelProtocols(
  db: D1Database,
  channelId: string,
  protocols: ChannelProtocolInput[],
): Promise<void> {
  await db.prepare('DELETE FROM channel_protocols WHERE channel_id = ?').bind(channelId).run();
  for (const entry of protocols) {
    await db.prepare(`INSERT INTO channel_protocols
      (channel_id, protocol, base_url, auth_scheme, api_version)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(channelId, entry.protocol, entry.base_url, entry.auth_scheme, entry.api_version ?? null)
      .run();
  }
}

export async function updateChannel(
  db: D1Database,
  id: string,
  updates: {
    name?: string;
    base_url?: string;
    api_key_ciphertext?: string;
    api_key_iv?: string;
    status?: string;
    notes?: string | null;
  },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.base_url !== undefined) {
    fields.push('base_url = ?');
    values.push(updates.base_url);
  }
  if (updates.api_key_ciphertext !== undefined) {
    fields.push('api_key_ciphertext = ?');
    values.push(updates.api_key_ciphertext);
  }
  if (updates.api_key_iv !== undefined) {
    fields.push('api_key_iv = ?');
    values.push(updates.api_key_iv);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?');
    values.push(updates.notes);
  }

  values.push(id);
  await db.prepare(`UPDATE channels SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`).bind(...values).run();
}

export async function softDeleteChannel(db: D1Database, id: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('UPDATE channels SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, id)
    .run();
}

/**
 * Check if a channel is referenced by any active model instance.
 */
export async function isChannelReferenced(db: D1Database, channelId: string): Promise<boolean> {
  const result = await db
    .prepare(
      'SELECT COUNT(*) as cnt FROM channel_models WHERE channel_id = ? AND deleted_at IS NULL',
    )
    .bind(channelId)
    .first<{ cnt: number }>();
  return (result?.cnt ?? 0) > 0;
}

/**
 * Hard-delete all model instances referencing a channel (cascade on channel delete).
 * Instances are useless once their channel is gone, so we remove them entirely
 * (and their identifiers) rather than soft-deleting — this also frees aliases.
 */
export async function softDeleteInstancesByChannel(db: D1Database, channelId: string): Promise<void> {
  // Remove identifiers pointing at instances of this channel
  await db
    .prepare(`DELETE FROM model_identifiers WHERE channel_model_id IN (
      SELECT id FROM channel_models WHERE channel_id = ?
    )`)
    .bind(channelId)
    .run();
  // Hard-delete the instances
  await db
    .prepare('DELETE FROM channel_models WHERE channel_id = ?')
    .bind(channelId)
    .run();
}
