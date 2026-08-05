import type { Env } from '../env.ts';
import { listChannels, toPublicChannel } from '../db/channels.ts';
import { listChannelModelSummaries } from '../db/provider-models.ts';
import { cachedProviderBalances } from './provider-balances.ts';

export async function handleChannelOverview(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: { message: 'Method not allowed' } }, { status: 405 });
  }
  const channels = await listChannels(env.DB);
  const summaries = await listChannelModelSummaries(env.DB);
  return Response.json({
    channels: channels.map(toPublicChannel),
    summaries,
    balances: cachedProviderBalances(channels),
  });
}
