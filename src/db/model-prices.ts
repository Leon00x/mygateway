/**
 * Global model price baseline (model_prices) — editable, used to prefill
 * channel-instance prices when a model is imported.
 */

export interface ModelPriceRow {
  provider_model_id: string;
  display_name: string;
  provider: string;
  input_price_micros_per_million: number;
  output_price_micros_per_million: number;
  cache_input_price_micros_per_million: number | null;
  currency: string;
  updated_at: number;
}

/** Look up baseline prices for a batch of provider model ids. */
export async function getModelPrices(
  db: D1Database,
  providerModelIds: string[],
): Promise<Map<string, ModelPriceRow>> {
  const map = new Map<string, ModelPriceRow>();
  if (providerModelIds.length === 0) return map;
  const placeholders = providerModelIds.map(() => '?').join(', ');
  const result = await db
    .prepare(`SELECT * FROM model_prices WHERE provider_model_id IN (${placeholders})`)
    .bind(...providerModelIds)
    .all<ModelPriceRow>();
  for (const row of result.results) map.set(row.provider_model_id, row);
  return map;
}

export async function listModelPrices(db: D1Database): Promise<ModelPriceRow[]> {
  const result = await db
    .prepare('SELECT * FROM model_prices ORDER BY provider ASC, provider_model_id ASC')
    .all<ModelPriceRow>();
  return result.results;
}

export async function upsertModelPrice(
  db: D1Database,
  entry: {
    provider_model_id: string;
    display_name: string;
    provider: string;
    input_price_micros_per_million: number;
    output_price_micros_per_million: number;
    cache_input_price_micros_per_million: number | null;
    currency: string;
  },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO model_prices (
        provider_model_id, display_name, provider,
        input_price_micros_per_million, output_price_micros_per_million,
        cache_input_price_micros_per_million, currency, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_model_id) DO UPDATE SET
        display_name = excluded.display_name,
        provider = excluded.provider,
        input_price_micros_per_million = excluded.input_price_micros_per_million,
        output_price_micros_per_million = excluded.output_price_micros_per_million,
        cache_input_price_micros_per_million = excluded.cache_input_price_micros_per_million,
        currency = excluded.currency,
        updated_at = excluded.updated_at`,
    )
    .bind(
      entry.provider_model_id,
      entry.display_name,
      entry.provider,
      entry.input_price_micros_per_million,
      entry.output_price_micros_per_million,
      entry.cache_input_price_micros_per_million,
      entry.currency,
      now,
    )
    .run();
}

export async function deleteModelPrice(db: D1Database, providerModelId: string): Promise<void> {
  await db.prepare('DELETE FROM model_prices WHERE provider_model_id = ?').bind(providerModelId).run();
}
