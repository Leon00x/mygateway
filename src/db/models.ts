/**
 * Model cards and channel model instances — database operations.
 */

import { parseCandidateProtocols, type ChannelProtocol } from '../gateway/protocols.ts';

export interface ModelCardRow {
  id: string;
  unified_model_id: string;
  display_name: string;
  status: 'active' | 'disabled';
  created_at: number;
  updated_at: number;
}

export interface ChannelModelRow {
  id: string;
  model_card_id: string;
  channel_id: string;
  channel_model_id: string;
  public_model_alias: string;
  sort_order: number;
  status: 'active' | 'disabled';
  supports_stream_usage: 0 | 1;
  input_price_micros_per_million: number | null;
  output_price_micros_per_million: number | null;
  currency: string | null;
  plan_tokens_total: number | null;
  plan_tokens_remaining: number | null;
  plan_expires_at: number | null;
  manual_metadata_updated_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ModelIdentifierRow {
  identifier: string;
  identifier_type: 'unified' | 'alias';
  model_card_id: string;
  channel_model_id: string | null;
}

// --- Model Cards ---

export async function listModelCards(db: D1Database): Promise<ModelCardRow[]> {
  const result = await db
    .prepare('SELECT * FROM model_cards WHERE deleted_at IS NULL ORDER BY created_at DESC')
    .all<ModelCardRow>();
  return result.results;
}

export async function getModelCard(db: D1Database, id: string): Promise<ModelCardRow | null> {
  return db
    .prepare('SELECT * FROM model_cards WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<ModelCardRow>();
}

export async function createModelCard(
  db: D1Database,
  card: { id: string; unified_model_id: string; display_name: string; status?: string },
): Promise<void> {
  const status = card.status ?? 'active';
  await db
    .prepare(
      `INSERT INTO model_cards (id, unified_model_id, display_name, status)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(card.id, card.unified_model_id, card.display_name, status)
    .run();
}

export async function updateModelCard(
  db: D1Database,
  id: string,
  updates: { display_name?: string; status?: string },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  values.push(id);
  await db
    .prepare(`UPDATE model_cards SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`)
    .bind(...values)
    .run();
}

export async function softDeleteModelCard(db: D1Database, id: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('UPDATE model_cards SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, id)
    .run();
}

// --- Channel Model Instances ---

export async function listChannelModels(
  db: D1Database,
  modelCardId: string,
): Promise<ChannelModelRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM channel_models WHERE model_card_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC',
    )
    .bind(modelCardId)
    .all<ChannelModelRow>();
  return result.results;
}

export async function createChannelModel(
  db: D1Database,
  instance: Omit<ChannelModelRow, 'created_at' | 'updated_at' | 'manual_metadata_updated_at'>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO channel_models (
        id, model_card_id, channel_id, channel_model_id, public_model_alias,
        sort_order, status, supports_stream_usage,
        input_price_micros_per_million, output_price_micros_per_million, currency,
        plan_tokens_total, plan_tokens_remaining, plan_expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      instance.id,
      instance.model_card_id,
      instance.channel_id,
      instance.channel_model_id,
      instance.public_model_alias,
      instance.sort_order,
      instance.status,
      instance.supports_stream_usage,
      instance.input_price_micros_per_million,
      instance.output_price_micros_per_million,
      instance.currency,
      instance.plan_tokens_total,
      instance.plan_tokens_remaining,
      instance.plan_expires_at,
    )
    .run();
}

export async function reorderInstances(
  db: D1Database,
  modelCardId: string,
  instanceIds: string[],
): Promise<void> {
  for (let i = 0; i < instanceIds.length; i++) {
    await db
      .prepare('UPDATE channel_models SET sort_order = ? WHERE id = ? AND model_card_id = ?')
      .bind(i, instanceIds[i], modelCardId)
      .run();
  }
}

// --- Model Identifiers ---

export async function resolveIdentifier(
  db: D1Database,
  identifier: string,
): Promise<ModelIdentifierRow | null> {
  return db
    .prepare('SELECT identifier, identifier_type, model_card_id, channel_model_id FROM model_identifiers WHERE identifier = ?')
    .bind(identifier)
    .first<ModelIdentifierRow>();
}

export async function createIdentifier(
  db: D1Database,
  ident: ModelIdentifierRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO model_identifiers (identifier, identifier_type, model_card_id, channel_model_id) VALUES (?, ?, ?, ?)',
    )
    .bind(ident.identifier, ident.identifier_type, ident.model_card_id, ident.channel_model_id)
    .run();
}

export async function deleteIdentifier(db: D1Database, identifier: string): Promise<void> {
  await db.prepare('DELETE FROM model_identifiers WHERE identifier = ?').bind(identifier).run();
}

/**
 * Get all enabled candidates for a model card, joined with channel info.
 */
export async function getCandidatesForModel(
  db: D1Database,
  modelCardId: string,
): Promise<CandidateRow[]> {
  return db
    .prepare(
      `SELECT
        cm.id AS channel_model_id_pk,
        cm.channel_model_id,
        cm.public_model_alias,
        cm.sort_order,
        cm.supports_stream_usage,
        c.id AS channel_id,
        c.name AS channel_name,
        c.provider_type,
        c.base_url,
        (SELECT json_group_array(json_object(
          'protocol', cp.protocol,
          'base_url', cp.base_url,
          'auth_scheme', cp.auth_scheme,
          'api_version', cp.api_version
        )) FROM channel_protocols cp WHERE cp.channel_id = c.id) AS protocols_json,
        c.api_key_ciphertext,
        c.api_key_iv,
        c.api_key_version
      FROM channel_models cm
      JOIN channels c ON c.id = cm.channel_id
      WHERE cm.model_card_id = ?
        AND cm.status = 'active'
        AND cm.deleted_at IS NULL
        AND c.status = 'active'
        AND c.deleted_at IS NULL
      ORDER BY cm.sort_order ASC, cm.id ASC`,
    )
    .bind(modelCardId)
    .all<CandidateQueryRow>()
    .then((r) => r.results.map(hydrateCandidate));
}

export interface CandidateRow {
  channel_model_id_pk: string;
  channel_model_id: string;
  public_model_alias: string;
  sort_order: number;
  supports_stream_usage: 0 | 1;
  channel_id: string;
  channel_name: string;
  provider_type: string;
  base_url: string;
  protocols: ChannelProtocol[];
  api_key_ciphertext: string;
  api_key_iv: string;
  api_key_version: number;
}

export interface CandidateQueryRow extends Omit<CandidateRow, 'protocols'> {
  protocols_json?: string;
}

export function hydrateCandidate(row: CandidateQueryRow): CandidateRow {
  return {
    ...row,
    protocols: parseCandidateProtocols(row.protocols_json, row.base_url),
  };
}
