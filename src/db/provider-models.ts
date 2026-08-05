export type ProviderModelSource = 'discovered' | 'manual' | 'preset';
export type ProviderModelAvailability = 'available' | 'missing' | 'unknown';

export interface ProviderModelRow {
  channel_id: string;
  provider_model_id: string;
  display_name: string;
  source: ProviderModelSource;
  availability: ProviderModelAvailability;
  capabilities_json: string | null;
  imported_model_card_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface DiscoveryStateRow {
  channel_id: string;
  status: 'never' | 'ok' | 'error';
  result_hash: string | null;
  model_count: number;
  last_attempt_at: number | null;
  last_success_at: number | null;
  error_summary: string | null;
}

export interface DiscoveredProviderModel {
  id: string;
  displayName: string;
  capabilities?: unknown;
}

export interface ChannelModelSummary {
  channel_id: string;
  model_count: number;
  available_count: number;
  imported_count: number;
  preview: Array<{ provider_model_id: string; display_name: string }>;
  discovery_status: DiscoveryStateRow['status'];
  last_success_at: number | null;
  error_summary: string | null;
}

interface ChannelModelSummaryQueryRow {
  channel_id: string;
  model_count: number;
  available_count: number;
  imported_count: number;
  preview_json: string;
  discovery_status: DiscoveryStateRow['status'] | null;
  last_success_at: number | null;
  error_summary: string | null;
}

/** One indexed statement for every channel card; never queries per card. */
export async function listChannelModelSummaries(db: D1Database): Promise<ChannelModelSummary[]> {
  const result = await db.prepare(
    `SELECT c.id AS channel_id,
       COUNT(cpm.provider_model_id) AS model_count,
       COALESCE(SUM(CASE WHEN cpm.availability = 'available' THEN 1 ELSE 0 END), 0) AS available_count,
       COALESCE(SUM(CASE WHEN cpm.imported_model_card_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS imported_count,
       COALESCE((SELECT json_group_array(json_object(
         'provider_model_id', preview.provider_model_id,
         'display_name', preview.display_name
       )) FROM (
         SELECT provider_model_id, display_name FROM channel_provider_models
         WHERE channel_id = c.id AND availability = 'available'
         ORDER BY provider_model_id ASC LIMIT 3
       ) AS preview), '[]') AS preview_json,
       cmd.status AS discovery_status, cmd.last_success_at, cmd.error_summary
     FROM channels c
     LEFT JOIN channel_provider_models cpm ON cpm.channel_id = c.id
     LEFT JOIN channel_model_discovery cmd ON cmd.channel_id = c.id
     WHERE c.deleted_at IS NULL
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
  ).all<ChannelModelSummaryQueryRow>();
  return result.results.map((row) => ({
    channel_id: row.channel_id,
    model_count: Number(row.model_count),
    available_count: Number(row.available_count),
    imported_count: Number(row.imported_count),
    preview: JSON.parse(row.preview_json) as ChannelModelSummary['preview'],
    discovery_status: row.discovery_status ?? 'never',
    last_success_at: row.last_success_at,
    error_summary: row.error_summary,
  }));
}

export async function listProviderModels(db: D1Database, channelId: string): Promise<ProviderModelRow[]> {
  const result = await db.prepare(
    `SELECT * FROM channel_provider_models WHERE channel_id = ?
     ORDER BY availability = 'available' DESC, provider_model_id ASC`,
  ).bind(channelId).all<ProviderModelRow>();
  return result.results;
}

export async function getProviderModel(
  db: D1Database,
  channelId: string,
  providerModelId: string,
): Promise<ProviderModelRow | null> {
  return db.prepare(
    'SELECT * FROM channel_provider_models WHERE channel_id = ? AND provider_model_id = ?',
  ).bind(channelId, providerModelId).first<ProviderModelRow>();
}

export async function getDiscoveryState(db: D1Database, channelId: string): Promise<DiscoveryStateRow | null> {
  return db.prepare('SELECT * FROM channel_model_discovery WHERE channel_id = ?')
    .bind(channelId).first<DiscoveryStateRow>();
}

export async function saveDiscoveryError(db: D1Database, channelId: string, message: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO channel_model_discovery (channel_id, status, last_attempt_at, error_summary)
     VALUES (?, 'error', ?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET status = 'error', last_attempt_at = excluded.last_attempt_at,
       error_summary = excluded.error_summary`,
  ).bind(channelId, now, message.slice(0, 300)).run();
}

export async function syncDiscoveredProviderModels(
  db: D1Database,
  channelId: string,
  models: DiscoveredProviderModel[],
  resultHash: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const state = await getDiscoveryState(db, channelId);
  if (state?.result_hash !== resultHash) {
    const ids = new Set(models.map((model) => model.id));
    const current = await listProviderModels(db, channelId);
    for (const row of current) {
      if (row.source === 'discovered' && !ids.has(row.provider_model_id)) {
        await db.prepare(
          `UPDATE channel_provider_models SET availability = 'missing', updated_at = ?
           WHERE channel_id = ? AND provider_model_id = ?`,
        ).bind(now, channelId, row.provider_model_id).run();
      }
    }
    for (const model of models) {
      await db.prepare(
        `INSERT INTO channel_provider_models
          (channel_id, provider_model_id, display_name, source, availability, capabilities_json, updated_at)
         VALUES (?, ?, ?, 'discovered', 'available', ?, ?)
         ON CONFLICT(channel_id, provider_model_id) DO UPDATE SET
           display_name = excluded.display_name,
           source = CASE WHEN channel_provider_models.source = 'manual' THEN 'manual' ELSE 'discovered' END,
           availability = 'available', capabilities_json = excluded.capabilities_json,
           updated_at = excluded.updated_at`,
      ).bind(
        channelId,
        model.id,
        model.displayName,
        model.capabilities === undefined ? null : JSON.stringify(model.capabilities),
        now,
      ).run();
    }
  }
  await db.prepare(
    `INSERT INTO channel_model_discovery
      (channel_id, status, result_hash, model_count, last_attempt_at, last_success_at, error_summary)
     VALUES (?, 'ok', ?, ?, ?, ?, NULL)
     ON CONFLICT(channel_id) DO UPDATE SET status = 'ok', result_hash = excluded.result_hash,
       model_count = excluded.model_count, last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at, error_summary = NULL`,
  ).bind(channelId, resultHash, models.length, now, now).run();
}

export async function addManualProviderModel(
  db: D1Database,
  channelId: string,
  providerModelId: string,
  displayName: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO channel_provider_models
      (channel_id, provider_model_id, display_name, source, availability, updated_at)
     VALUES (?, ?, ?, 'manual', 'available', ?)
     ON CONFLICT(channel_id, provider_model_id) DO UPDATE SET display_name = excluded.display_name,
       source = 'manual', availability = 'available', updated_at = excluded.updated_at`,
  ).bind(channelId, providerModelId, displayName, now).run();
}

export async function deleteProviderModel(db: D1Database, channelId: string, providerModelId: string): Promise<void> {
  await db.prepare('DELETE FROM channel_provider_models WHERE channel_id = ? AND provider_model_id = ?')
    .bind(channelId, providerModelId).run();
}

export async function markProviderModelImported(
  db: D1Database,
  channelId: string,
  providerModelId: string,
  modelCardId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE channel_provider_models SET imported_model_card_id = ?, updated_at = unixepoch()
     WHERE channel_id = ? AND provider_model_id = ?`,
  ).bind(modelCardId, channelId, providerModelId).run();
}
