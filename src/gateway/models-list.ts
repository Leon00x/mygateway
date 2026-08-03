/**
 * GET /v1/models — return configured models list.
 */

import { Env } from '../env.ts';
import { gatewayResponseHeaders } from '../http/headers.ts';
import { listModelCards, listChannelModels } from '../db/models.ts';

export async function handleModelsList(
  env: Env,
  requestId: string,
): Promise<Response> {
  const cards = await listModelCards(env.DB);
  const models: Array<{ id: string; object: string; created: number; owned_by: string }> = [];

  for (const card of cards) {
    if (card.status !== 'active') continue;

    // Add unified model ID
    models.push({
      id: card.unified_model_id,
      object: 'model',
      created: card.created_at,
      owned_by: 'mygateway',
    });

    // Add all public aliases
    const instances = await listChannelModels(env.DB, card.id);
    for (const inst of instances) {
      if (inst.status !== 'active') continue;
      models.push({
        id: inst.public_model_alias,
        object: 'model',
        created: inst.created_at,
        owned_by: 'mygateway',
      });
    }
  }

  const headers = gatewayResponseHeaders(requestId);
  headers.set('Content-Type', 'application/json');

  return new Response(
    JSON.stringify({ object: 'list', data: models }),
    { status: 200, headers },
  );
}
