/**
 * Admin model price baseline API — maintain the editable price library.
 */

import { Env } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { json } from './router.ts';
import { listModelPrices, upsertModelPrice, deleteModelPrice } from '../db/model-prices.ts';

function parseMicros(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Price must be a non-negative number');
  return Math.round(n);
}

function normalizeCurrency(value: unknown): 'USD' | 'CNY' {
  return value === 'CNY' ? 'CNY' : 'USD';
}

/** GET /admin/api/model-prices — list the whole baseline. */
export async function handleModelPricesList(_request: Request, env: Env, requestId: string): Promise<Response> {
  try {
    const prices = await listModelPrices(env.DB);
    return json({ prices });
  } catch {
    return gatewayErrorResponse('upstream_error', 'Failed to load model prices', requestId);
  }
}

/** PUT /admin/api/model-prices — bulk upsert prices. */
export async function handleModelPricesUpsert(request: Request, env: Env, requestId: string): Promise<Response> {
  try {
    const body = (await request.json()) as { prices?: unknown };
    if (!Array.isArray(body.prices) || body.prices.length === 0 || body.prices.length > 500) {
      return gatewayErrorResponse('invalid_request', 'prices must contain 1 to 500 items', requestId);
    }
    for (const raw of body.prices) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const id = typeof item.provider_model_id === 'string' ? item.provider_model_id.trim() : '';
      if (!id) continue;
      await upsertModelPrice(env.DB, {
        provider_model_id: id,
        display_name: typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name.trim() : id,
        provider: typeof item.provider === 'string' && item.provider.trim() ? item.provider.trim() : 'custom',
        input_price_micros_per_million: parseMicros(item.input_price_micros_per_million) ?? 0,
        output_price_micros_per_million: parseMicros(item.output_price_micros_per_million) ?? 0,
        cache_input_price_micros_per_million: parseMicros(item.cache_input_price_micros_per_million),
        currency: normalizeCurrency(item.currency),
      });
    }
    const prices = await listModelPrices(env.DB);
    return json({ ok: true, prices });
  } catch (e) {
    return gatewayErrorResponse('invalid_request', (e as Error).message, requestId);
  }
}

/** DELETE /admin/api/model-prices/:id */
export async function handleModelPriceDelete(request: Request, id: string, env: Env, requestId: string): Promise<Response> {
  if (request.method !== 'DELETE') {
    return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  }
  await deleteModelPrice(env.DB, id);
  return json({ ok: true });
}
