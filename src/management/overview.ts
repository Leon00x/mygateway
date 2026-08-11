import type { Env } from '../env.ts';
import { listChannels } from '../db/channels.ts';
import { listGatewayKeys, toPublicKey } from '../db/keys.ts';
import { cachedProviderBalances } from '../admin/provider-balances.ts';

type SetupState = 'needs_channel' | 'needs_model' | 'needs_gateway_key' | 'ready';

interface OverviewModelRow {
  id: string;
  unified_model_id: string;
  display_name: string;
  model_status: 'active' | 'disabled';
  instance_id: string | null;
  channel_id: string | null;
  channel_name: string | null;
  channel_model_id: string | null;
  public_model_alias: string | null;
  sort_order: number | null;
  instance_status: 'active' | 'disabled' | null;
  channel_status: 'active' | 'disabled' | null;
  input_price_micros_per_million: number | null;
  output_price_micros_per_million: number | null;
  cache_input_price_micros_per_million: number | null;
  currency: string | null;
}

function recommendedAction(state: SetupState): string {
  if (state === 'needs_channel') return 'add_channel';
  if (state === 'needs_model') return 'configure_model';
  if (state === 'needs_gateway_key') return 'create_gateway_key';
  return 'none';
}

/** A compact, secret-free bootstrap view for agents connecting to a deployment. */
export async function handleManagementOverview(
  env: Env,
  permission: 'read' | 'write',
): Promise<Response> {
  const [channels, modelResult, keyRows] = await Promise.all([
    listChannels(env.DB),
    env.DB.prepare(`
      SELECT
        mc.id, mc.unified_model_id, mc.display_name, mc.status AS model_status,
        cm.id AS instance_id, cm.channel_id, c.name AS channel_name,
        cm.channel_model_id, cm.public_model_alias, cm.sort_order,
        cm.status AS instance_status, c.status AS channel_status,
        cm.input_price_micros_per_million, cm.output_price_micros_per_million,
        cm.cache_input_price_micros_per_million, cm.currency
      FROM model_cards mc
      LEFT JOIN channel_models cm
        ON cm.model_card_id = mc.id AND cm.deleted_at IS NULL
      LEFT JOIN channels c
        ON c.id = cm.channel_id AND c.deleted_at IS NULL
      WHERE mc.deleted_at IS NULL
      ORDER BY mc.created_at DESC, cm.sort_order ASC
    `).all<OverviewModelRow>(),
    listGatewayKeys(env.DB),
  ]);

  const modelMap = new Map<string, {
    id: string;
    unified_model_id: string;
    display_name: string;
    status: 'active' | 'disabled';
    instances: Array<{
      id: string;
      channel_id: string;
      channel_name: string;
      provider_model_id: string;
      public_model_alias: string;
      sort_order: number;
      status: 'active' | 'disabled';
      channel_status: 'active' | 'disabled';
      pricing_configured: boolean;
      currency: string | null;
    }>;
  }>();

  for (const row of modelResult.results) {
    let model = modelMap.get(row.id);
    if (!model) {
      model = {
        id: row.id,
        unified_model_id: row.unified_model_id,
        display_name: row.display_name,
        status: row.model_status,
        instances: [],
      };
      modelMap.set(row.id, model);
    }
    if (row.instance_id && row.channel_id && row.channel_name && row.channel_model_id
      && row.public_model_alias && row.instance_status && row.channel_status) {
      model.instances.push({
        id: row.instance_id,
        channel_id: row.channel_id,
        channel_name: row.channel_name,
        provider_model_id: row.channel_model_id,
        public_model_alias: row.public_model_alias,
        sort_order: row.sort_order ?? model.instances.length,
        status: row.instance_status,
        channel_status: row.channel_status,
        pricing_configured: row.input_price_micros_per_million !== null
          || row.output_price_micros_per_million !== null
          || row.cache_input_price_micros_per_million !== null,
        currency: row.currency,
      });
    }
  }

  const models = [...modelMap.values()];
  const readyModels = models.filter((model) => model.status === 'active'
    && model.instances.some((instance) => instance.status === 'active' && instance.channel_status === 'active'));
  const now = Math.floor(Date.now() / 1000);
  const keys = keyRows.map(toPublicKey);
  const activeKeys = keys.filter((key) => key.status === 'active'
    && (key.expires_at === null || key.expires_at > now));

  let setupState: SetupState = 'ready';
  if (channels.length === 0) setupState = 'needs_channel';
  else if (readyModels.length === 0) setupState = 'needs_model';
  else if (activeKeys.length === 0) setupState = 'needs_gateway_key';

  return Response.json({
    system: { version: env.APP_VERSION ?? '0.1.0', status: 'ok' },
    authorization: { permission },
    setup_state: setupState,
    ready_for_inference: setupState === 'ready',
    recommended_action: recommendedAction(setupState),
    channels: {
      total: channels.length,
      active: channels.filter((channel) => channel.status === 'active').length,
      disabled: channels.filter((channel) => channel.status === 'disabled').length,
      items: channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        provider_type: channel.provider_type,
        preset_id: channel.preset_id,
        status: channel.status,
        protocols: channel.protocols.map((protocol) => protocol.protocol),
      })),
    },
    models: {
      total: models.length,
      ready: readyModels.length,
      unbound: models.filter((model) => model.instances.length === 0).length,
      items: models,
    },
    gateway_keys: {
      total: keys.length,
      active: activeKeys.length,
      disabled_or_expired: keys.length - activeKeys.length,
      items: keys.map((key) => ({
        id: key.id,
        name: key.name,
        status: key.status,
        expires_at: key.expires_at,
        model_allowlist: key.model_allowlist,
        is_temporary: key.is_temporary,
      })),
    },
    balances: cachedProviderBalances(channels),
  });
}
