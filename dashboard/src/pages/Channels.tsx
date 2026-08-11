import { createMemo, createSignal, onMount, For, Show } from 'solid-js';
import {
  PROVIDER_PRESETS,
  localizedChannelName,
  localizedPresetName,
  type ProviderPreset,
} from '../presets';
import { ProviderLogo } from '../components/ProviderLogo';
import Icon from '../components/Icon';
import { locale, t } from '../i18n';
import PriceFields, { emptyPrice, priceInputFromMicros, microsFromDollars, type PriceInput } from '../components/PriceFields';
import { useAppDialog } from '../components/AppDialog';
import {
  balanceCurrencySymbol,
  balanceUpdatedAt,
  forgetProviderBalance,
  mergeProviderBalances,
  type ProviderBalance,
} from '../provider-balances';

interface ChannelProtocol {
  protocol: string;
  base_url: string;
  auth_scheme: 'bearer' | 'x_api_key';
  api_version?: string | null;
}

interface ProtocolDraft extends ChannelProtocol { enabled: boolean; }
const PROTOCOLS = ['openai_chat', 'openai_responses', 'anthropic_messages'] as const;
const protocolPath = (protocol: string) => ({ openai_chat: '/chat/completions', openai_responses: '/responses', anthropic_messages: '/messages' }[protocol] ?? '');
const protocolDrafts = (existing: ChannelProtocol[] = [], fallback = ''): ProtocolDraft[] => PROTOCOLS.map((protocol) => {
  const saved = existing.find((entry) => entry.protocol === protocol);
  return {
    protocol, base_url: saved?.base_url ?? fallback,
    auth_scheme: saved?.auth_scheme ?? (protocol === 'anthropic_messages' ? 'x_api_key' : 'bearer'),
    api_version: saved?.api_version ?? (protocol === 'anthropic_messages' ? '2023-06-01' : null),
    enabled: Boolean(saved),
  };
});
const enabledProtocols = (drafts: ProtocolDraft[]): ChannelProtocol[] => drafts.filter((entry) => entry.enabled).map(({ enabled: _enabled, ...entry }) => entry);

interface Channel {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  has_api_key: boolean;
  status: string;
  notes: string | null;
  preset_id: string | null;
  short_code: string | null;
  protocols: ChannelProtocol[];
}

interface InventoryModel {
  provider_model_id: string;
  display_name: string;
  source: 'discovered' | 'manual' | 'preset';
  availability: 'available' | 'missing' | 'unknown';
  imported_model_card_id: string | null;
}

interface DiscoveryState {
  status: 'never' | 'ok' | 'error';
  model_count: number;
  last_success_at: number | null;
  error_summary: string | null;
}

interface ChannelSummary {
  channel_id: string;
  model_count: number;
  available_count: number;
  imported_count: number;
  preview: Array<{ provider_model_id: string; display_name: string }>;
  discovery_status: DiscoveryState['status'];
  last_success_at: number | null;
  error_summary: string | null;
}

interface ChannelOverviewResponse {
  channels: Channel[];
  summaries: ChannelSummary[];
  balances: ProviderBalance[];
}

interface ChannelDeleteImpact {
  instance_count: number;
  affected_model_count: number;
  orphan_model_count: number;
  models: Array<{ unified_model_id: string; will_delete_model: boolean }>;
}

interface PreflightModel {
  provider_model_id: string;
  display_name: string;
  capabilities?: unknown;
  baseline_price?: { input: number; output: number; cache: number | null; currency: string } | null;
}

interface ChannelPreflight {
  status: 'ok' | 'error';
  models: PreflightModel[];
  error?: string;
}

const initPrices = (models: PreflightModel[]): Record<string, PriceInput> => {
  const map: Record<string, PriceInput> = {};
  for (const m of models) {
    map[m.provider_model_id] = m.baseline_price
      ? priceInputFromMicros(m.baseline_price.input, m.baseline_price.output, m.baseline_price.cache, m.baseline_price.currency)
      : emptyPrice();
  }
  return map;
};

const protocolLabel = (protocol: string) => ({
  openai_chat: 'Chat', openai_responses: 'Responses', anthropic_messages: 'Messages',
}[protocol] ?? protocol);

const providerTypeLabel = (providerType: string) => providerType === 'openai' ? t('channels.typeOpenAI') : t('channels.typeCompatible');
const PRESET_DESCRIPTIONS_EN: Record<string, string> = {
  deepseek: 'Official DeepSeek API with native Chat and Messages endpoints', zai: 'Z.AI international GLM API with OpenAI Chat compatibility',
  huawei_cloud_cn: 'ModelArts Studio MaaS endpoints for mainland China', alibaba_cloud_intl: 'Alibaba Model Studio international endpoints',
  byteplus_modelark: 'BytePlus ModelArk endpoints for Southeast Asia', google_gemini: 'Google AI Studio with OpenAI Chat compatibility',
  groq: 'GroqCloud high-speed inference endpoints', minimax_intl: 'MiniMax international API endpoints', xai: 'Official xAI API endpoints',
  mistral: 'Official Mistral AI API endpoints', openai: 'Official OpenAI Chat and Responses endpoints', siliconflow: 'SiliconFlow inference platform endpoints',
  moonshot: 'Moonshot AI official API endpoints', zhipu: 'Zhipu AI open platform endpoints', anthropic: 'Official Anthropic Messages endpoint',
};
const presetDescription = (preset: ProviderPreset) => locale() === 'en' ? (PRESET_DESCRIPTIONS_EN[preset.id] ?? preset.description) : preset.description;
const presetName = (preset: ProviderPreset) => localizedPresetName(preset, locale());
const channelName = (channel: Pick<Channel, 'name' | 'preset_id'>) => localizedChannelName(channel.name, channel.preset_id, locale());

function ProtocolEditor(props: { value: ProtocolDraft[]; onChange: (protocol: string, update: Partial<ProtocolDraft>) => void }) {
  return <div class="protocol-editor"><div class="protocol-editor-head"><strong>{t('channels.nativeProtocols')}</strong><span>{t('channels.protocolPathHint')}</span></div><For each={props.value}>{(entry) => <div class="protocol-editor-row" classList={{ disabled: !entry.enabled }}><label class="protocol-toggle"><input type="checkbox" checked={entry.enabled} onChange={(event) => props.onChange(entry.protocol, { enabled: event.currentTarget.checked })} /><span><strong>{protocolLabel(entry.protocol)}</strong><code>{protocolPath(entry.protocol)}</code></span></label><label class="protocol-url"><span>Base URL</span><input type="url" value={entry.base_url} placeholder="https://api.example.com/v1" disabled={!entry.enabled} required={entry.enabled} onInput={(event) => props.onChange(entry.protocol, { base_url: event.currentTarget.value })} /></label></div>}</For></div>;
}

export default function Channels() {
  const dialog = useAppDialog();
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [summaries, setSummaries] = createSignal<Record<string, ChannelSummary>>({});
  const [balances, setBalances] = createSignal<Record<string, ProviderBalance>>({});
  const [loading, setLoading] = createSignal(true);
  const [balanceBusy, setBalanceBusy] = createSignal<Record<string, boolean>>({});

  const [showProviderPicker, setShowProviderPicker] = createSignal(false);
  const [selectedPreset, setSelectedPreset] = createSignal<ProviderPreset | null>(null);
  const [presetApiKey, setPresetApiKey] = createSignal('');
  const [presetError, setPresetError] = createSignal('');
  const [presetBusy, setPresetBusy] = createSignal(false);
  const [presetPreflight, setPresetPreflight] = createSignal<ChannelPreflight | null>(null);
  const [presetSelectedModels, setPresetSelectedModels] = createSignal<Set<string>>(new Set());
  const [presetPrices, setPresetPrices] = createSignal<Record<string, PriceInput>>({});
  const [presetProtocols, setPresetProtocols] = createSignal<ProtocolDraft[]>([]);

  const [showCustom, setShowCustom] = createSignal(false);
  const [cName, setCName] = createSignal('');
  const [cType, setCType] = createSignal('openai_compatible');
  const [cKey, setCKey] = createSignal('');
  const [cProtocols, setCProtocols] = createSignal<ProtocolDraft[]>(protocolDrafts().map((entry) => ({ ...entry, enabled: entry.protocol === 'openai_chat' })));
  const [cError, setCErr] = createSignal('');
  const [cBusy, setCBusy] = createSignal(false);
  const [customPreflight, setCustomPreflight] = createSignal<ChannelPreflight | null>(null);
  const [customSelectedModels, setCustomSelectedModels] = createSignal<Set<string>>(new Set());
  const [customPrices, setCustomPrices] = createSignal<Record<string, PriceInput>>({});

  const [editChannel, setEditChannel] = createSignal<Channel | null>(null);
  const [editName, setEditName] = createSignal('');
  const [editKey, setEditKey] = createSignal('');
  const [editProtocols, setEditProtocols] = createSignal<ProtocolDraft[]>([]);
  const [editBusy, setEditBusy] = createSignal(false);
  const [editError, setEditError] = createSignal('');

  const [detailChannel, setDetailChannel] = createSignal<Channel | null>(null);
  const [creationResult, setCreationResult] = createSignal(false);
  const [inventory, setInventory] = createSignal<InventoryModel[]>([]);
  const [discovery, setDiscovery] = createSignal<DiscoveryState | null>(null);
  const [inventoryBusy, setInventoryBusy] = createSignal(false);
  const [inventoryError, setInventoryError] = createSignal('');
  const [inventoryFilter, setInventoryFilter] = createSignal('');
  const [manualModel, setManualModel] = createSignal('');
  const [selectedModels, setSelectedModels] = createSignal<Set<string>>(new Set());
  const [suggestedIds, setSuggestedIds] = createSignal<Record<string, string>>({});

  const loadOverview = async () => {
    try {
      const response = await fetch('/admin/api/channels/overview');
      if (!response.ok) return;
      const data = await response.json() as ChannelOverviewResponse;
      setChannels(data.channels);
      setSummaries(Object.fromEntries(data.summaries.map((item) => [item.channel_id, item])));
      setBalances(Object.fromEntries(mergeProviderBalances(data.balances)
        .map((item) => [item.channel_id, item])));
    } finally { setLoading(false); }
  };

  onMount(() => { void loadOverview(); });

  const supportsBalance = (channel: Channel) => channel.preset_id === 'deepseek'
    || (() => { try { return new URL(channel.base_url).hostname === 'api.deepseek.com'; } catch { return false; } })();

  const refreshBalance = async (channel: Channel) => {
    if (!supportsBalance(channel)) return;
    setBalanceBusy((current) => ({ ...current, [channel.id]: true }));
    try {
      const response = await fetch(`/admin/api/channels/${channel.id}/balance?refresh=1`);
      const data = await response.json() as ProviderBalance | { error?: string };
      if ('channel_id' in data) setBalances((current) => ({
        ...current,
        ...Object.fromEntries(mergeProviderBalances([data])
          .map((item) => [item.channel_id, item])),
      }));
    } finally { setBalanceBusy((current) => ({ ...current, [channel.id]: false })); }
  };

  const toggleStatus = async (channel: Channel) => {
    await fetch(`/admin/api/channels/${channel.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: channel.status === 'active' ? 'disabled' : 'active' }),
    });
    await loadOverview();
  };

  const del = async (id: string) => {
    const impactResponse = await fetch(`/admin/api/channels/${id}/delete-impact`);
    if (!impactResponse.ok) { await dialog.notice({ title: t('common.error'), message: t('channels.deleteImpactFailed'), danger: true }); return; }
    const impact = await impactResponse.json() as ChannelDeleteImpact;
    const orphanPreview = impact.models.filter((model) => model.will_delete_model)
      .slice(0, 5).map((model) => model.unified_model_id).join('、');
    const message = impact.instance_count === 0
      ? t('channels.deleteNoModels')
      : `${t('channels.deleteImpactHead')} ${impact.instance_count} ${t('channels.deleteImpactInstances')}、${impact.affected_model_count} ${t('channels.deleteImpactModels')}。\n`
        + `${impact.orphan_model_count} ${t('channels.deleteOrphans')}${orphanPreview ? `：${orphanPreview}` : ''}。\n`
        + `${t('channels.deleteImpactTail')}\n\n${t('channels.confirmContinue')}？`;
    if (!await dialog.confirm({ title: t('channels.delete'), message, confirmLabel: t('channels.delete'), danger: true })) return;
    const response = await fetch(`/admin/api/channels/${id}`, { method: 'DELETE' });
    if (!response.ok) await dialog.notice({ title: t('common.error'), message: t('models.deleteFailed'), danger: true });
    else forgetProviderBalance(id);
    await loadOverview();
  };

  const test = async (id: string) => {
    const response = await fetch(`/admin/api/channels/${id}/test`, { method: 'POST' });
    const data = await response.json();
    await dialog.notice({ title: data.ok ? t('channels.connectedOk') : t('channels.detectFailed'), message: data.ok ? `${data.elapsed_ms} ms` : `${data.error ?? 'Failed'} (${data.elapsed_ms ?? '?'} ms)`, danger: !data.ok });
  };

  const openProviderPicker = () => {
    setSelectedPreset(null); setPresetApiKey(''); setPresetError(''); setPresetPreflight(null); setPresetSelectedModels(new Set<string>()); setPresetProtocols([]); setShowProviderPicker(true);
  };

  const chooseCustom = () => {
    setShowProviderPicker(false); setSelectedPreset(null); setShowCustom(true); setCErr(''); setCustomPreflight(null); setCustomSelectedModels(new Set<string>());
    setCProtocols(protocolDrafts().map((entry) => ({ ...entry, enabled: entry.protocol === 'openai_chat' })));
  };

  const applyInventory = (data: { models?: InventoryModel[]; discovery?: DiscoveryState }) => {
    const models = data.models ?? [];
    setInventory(models); if (data.discovery) setDiscovery(data.discovery);
    setSuggestedIds(Object.fromEntries(models.map((model) => [model.provider_model_id, model.provider_model_id])));
    setSelectedModels(new Set<string>());
  };

  const loadInventory = async (channel: Channel, refreshNow: boolean) => {
    setInventoryBusy(true); setInventoryError('');
    try {
      const suffix = refreshNow ? '/refresh' : '';
      const response = await fetch(`/admin/api/channels/${channel.id}/models${suffix}`, {
        method: refreshNow ? 'POST' : 'GET',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? t('channels.modelDetectFailed'));
      applyInventory(data);
    } catch (error) { setInventoryError((error as Error).message); }
    finally { setInventoryBusy(false); }
  };

  async function openDetails(
    channel: Channel,
    options: { refreshModels?: boolean; created?: boolean; importModelIds?: Set<string> } = {},
  ) {
    setDetailChannel(channel); setCreationResult(Boolean(options.created));
    setInventory([]); setDiscovery(null); setInventoryFilter(''); setManualModel(''); setInventoryError('');
    const inventoryJob = loadInventory(channel, Boolean(options.refreshModels));
    const balanceJob = options.created && supportsBalance(channel) ? refreshBalance(channel) : Promise.resolve();
    await inventoryJob;
    if (options.importModelIds?.size && !inventoryError()) await syncAvailableModels(channel, options.importModelIds);
    await balanceJob;
    await loadOverview();
  }

  const detectPreset = async () => {
    const preset = selectedPreset();
    if (!preset || !presetApiKey()) return;
    setPresetBusy(true); setPresetError(''); setPresetPreflight(null); setPresetSelectedModels(new Set<string>());
    try {
      const response = await fetch('/admin/api/channels/preflight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: presetApiKey(), preset_id: preset.id, base_url: enabledProtocols(presetProtocols())[0]?.base_url, protocols: enabledProtocols(presetProtocols()) }),
      });
      const data = await response.json();
      if (response.ok) {
        const models = (data.models ?? []) as PreflightModel[];
        setPresetPreflight({ status: 'ok', models });
        setPresetPrices(initPrices(models));
        setPresetSelectedModels(new Set(models.map((model: PreflightModel) => model.provider_model_id)));
      }
      else if (response.status === 502) setPresetPreflight({ status: 'error', models: [], error: data.error?.message ?? t('channels.detectFailed') });
      else setPresetError(data.error?.message ?? t('channels.connectionInfoInvalid'));
    } catch (error) {
      setPresetPreflight({ status: 'error', models: [], error: (error as Error).message });
    } finally { setPresetBusy(false); }
  };

  const submitPreset = async (event: Event) => {
    event.preventDefault(); const preset = selectedPreset();
    const preflight = presetPreflight();
    if (!preset || !presetApiKey() || !preflight) return;
    const syncAll = (event as SubmitEvent).submitter?.getAttribute('data-action') === 'sync';
    if (syncAll && (preflight.status !== 'ok' || presetSelectedModels().size === 0)) return;
    const importModelIds = syncAll ? new Set(presetSelectedModels()) : undefined;
    setPresetBusy(true); setPresetError('');
    try {
      const response = await fetch('/admin/api/channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: presetApiKey(), preset_id: preset.id, base_url: enabledProtocols(presetProtocols())[0]?.base_url, protocols: enabledProtocols(presetProtocols()),
          ...(preflight.status === 'ok' ? { detected_models: preflight.models } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const message = data.error?.message ?? t('channels.addFailed');
        if (response.status === 409) { await dialog.notice({ title: t('channels.duplicateTitle'), message: t('channels.duplicateBody'), danger: true }); return; }
        throw new Error(message);
      }
      setShowProviderPicker(false); setSelectedPreset(null); setPresetApiKey(''); setPresetPreflight(null); setPresetSelectedModels(new Set<string>());
      await openDetails(data as Channel, { created: true, importModelIds });
    } catch (error) { setPresetError((error as Error).message); }
    finally { setPresetBusy(false); }
  };

  const customPayload = () => ({
    name: cName(), provider_type: cType(), base_url: enabledProtocols(cProtocols())[0]?.base_url, api_key: cKey(), protocols: enabledProtocols(cProtocols()),
  });

  const detectCustom = async () => {
    if (!cName() || !cKey() || !enabledProtocols(cProtocols()).length) return;
    setCBusy(true); setCErr(''); setCustomPreflight(null); setCustomSelectedModels(new Set<string>());
    try {
      const response = await fetch('/admin/api/channels/preflight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(customPayload()),
      });
      const data = await response.json();
      if (response.ok) {
        const models = (data.models ?? []) as PreflightModel[];
        setCustomPreflight({ status: 'ok', models });
        setCustomPrices(initPrices(models));
        setCustomSelectedModels(new Set(models.map((model: PreflightModel) => model.provider_model_id)));
      }
      else if (response.status === 502) setCustomPreflight({ status: 'error', models: [], error: data.error?.message ?? t('channels.detectFailed') });
      else setCErr(data.error?.message ?? t('channels.connectionInfoInvalid'));
    } catch (error) {
      setCustomPreflight({ status: 'error', models: [], error: (error as Error).message });
    } finally { setCBusy(false); }
  };

  const submitCustom = async (event: Event) => {
    event.preventDefault();
    const preflight = customPreflight();
    if (!preflight) return;
    const syncAll = (event as SubmitEvent).submitter?.getAttribute('data-action') === 'sync';
    if (syncAll && (preflight.status !== 'ok' || customSelectedModels().size === 0)) return;
    const importModelIds = syncAll ? new Set(customSelectedModels()) : undefined;
    setCBusy(true); setCErr('');
    try {
      const response = await fetch('/admin/api/channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...customPayload(), ...(preflight.status === 'ok' ? { detected_models: preflight.models } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const message = data.error?.message ?? t('channels.addFailed');
        if (response.status === 409) { await dialog.notice({ title: t('channels.duplicateTitle'), message: t('channels.duplicateBody'), danger: true }); return; }
        throw new Error(message);
      }
      setShowCustom(false); setCName(''); setCKey(''); setCProtocols(protocolDrafts().map((entry) => ({ ...entry, enabled: entry.protocol === 'openai_chat' }))); setCustomPreflight(null); setCustomSelectedModels(new Set<string>());
      await openDetails(data as Channel, { created: true, importModelIds });
    } catch (error) { setCErr((error as Error).message); }
    finally { setCBusy(false); }
  };

  const updateProtocolDraft = (setter: typeof setCProtocols, protocol: string, update: Partial<ProtocolDraft>) => {
    setCustomPreflight(null);
    setter((current) => current.map((entry) => entry.protocol === protocol ? { ...entry, ...update } : entry));
  };

  const togglePreflightModel = (
    setter: typeof setPresetSelectedModels,
    modelId: string,
    checked: boolean,
  ) => setter((current) => {
    const next = new Set(current);
    checked ? next.add(modelId) : next.delete(modelId);
    return next;
  });

  const openEditor = (channel: Channel) => {
    setDetailChannel(null); setEditChannel(channel); setEditName(channelName(channel)); setEditKey('');
    setEditProtocols(protocolDrafts(channel.protocols, channel.base_url)); setEditError('');
  };

  const saveEdit = async (event: Event) => {
    event.preventDefault(); const channel = editChannel(); if (!channel) return;
    setEditBusy(true); setEditError('');
    try {
      const protocols = enabledProtocols(editProtocols());
      const body: Record<string, unknown> = { name: editName(), base_url: protocols[0]?.base_url ?? channel.base_url, protocols };
      if (editKey()) body.api_key = editKey();
      const response = await fetch(`/admin/api/channels/${channel.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? t('keys.saveFailed'));
      forgetProviderBalance(channel.id);
      setEditChannel(null); await loadOverview(); await openDetails(data as Channel);
    } catch (error) { setEditError((error as Error).message); }
    finally { setEditBusy(false); }
  };

  const updateEditProtocol = (protocol: string, update: Partial<ProtocolDraft>) => setEditProtocols((current) => current.map((entry) => entry.protocol === protocol ? { ...entry, ...update } : entry));

  const addManualModel = async (event: Event) => {
    event.preventDefault(); const channel = detailChannel(); if (!channel || !manualModel().trim()) return;
    const response = await fetch(`/admin/api/channels/${channel.id}/models`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_id: manualModel().trim() }),
    });
    const data = await response.json();
    if (response.ok) { applyInventory({ models: data.models }); setManualModel(''); await loadOverview(); }
  };

  const removeInventoryModel = async (modelId: string) => {
    const channel = detailChannel(); if (!channel || !await dialog.confirm({ title: t('channels.removeFromInventory'), message: modelId, danger: true })) return;
    await fetch(`/admin/api/channels/${channel.id}/models?model_id=${encodeURIComponent(modelId)}`, { method: 'DELETE' });
    setInventory((current) => current.filter((model) => model.provider_model_id !== modelId)); await loadOverview();
  };

  const toggleModel = (modelId: string, checked: boolean) => {
    setSelectedModels((current) => { const next = new Set(current); checked ? next.add(modelId) : next.delete(modelId); return next; });
  };

  async function importModels(channel: Channel, requested: Array<{ provider_model_id: string; unified_model_id: string }>) {
    if (requested.length === 0) return;
    setInventoryBusy(true); setInventoryError('');
    try {
      const failures: Array<{ ok: boolean }> = [];
      const priceMap = channel.preset_id ? presetPrices() : customPrices();
      for (let offset = 0; offset < requested.length; offset += 100) {
        const chunk = requested.slice(offset, offset + 100);
        const prices: Record<string, { input: number | null; output: number | null; cache: number | null; currency: string }> = {};
        for (const m of chunk) {
          const p = priceMap[m.provider_model_id];
          if (p) {
            prices[m.provider_model_id] = {
              input: microsFromDollars(p.input),
              output: microsFromDollars(p.output),
              cache: microsFromDollars(p.cache),
              currency: p.currency,
            };
          }
        }
        const response = await fetch(`/admin/api/channels/${channel.id}/models/import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ models: chunk, prices }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? t('channels.importFailed'));
        failures.push(...(data.results ?? []).filter((result: { ok: boolean }) => !result.ok));
        applyInventory({ models: data.models });
      }
      await loadOverview();
      if (failures.length) setInventoryError(`${failures.length} ${t('channels.importFailures')}`);
    } catch (error) { setInventoryError((error as Error).message); }
    finally { setInventoryBusy(false); }
  }

  async function syncAvailableModels(channel: Channel, modelIds?: Set<string>) {
    const requested = inventory().filter((model) => model.availability === 'available'
      && !model.imported_model_card_id && (!modelIds || modelIds.has(model.provider_model_id)))
      .map((model) => ({ provider_model_id: model.provider_model_id, unified_model_id: model.provider_model_id }));
    await importModels(channel, requested);
  }

  const importSelected = async () => {
    const channel = detailChannel(); if (!channel || selectedModels().size === 0) return;
    await importModels(channel, [...selectedModels()].map((provider_model_id) => ({
      provider_model_id, unified_model_id: suggestedIds()[provider_model_id],
    })));
  };

  const filteredInventory = createMemo(() => {
    const value = inventoryFilter().trim().toLowerCase();
    return value ? inventory().filter((model) => `${model.provider_model_id} ${model.display_name}`.toLowerCase().includes(value)) : inventory();
  });

  const balanceHeadline = (channel: Channel) => {
    const balance = balances()[channel.id];
    if (!supportsBalance(channel)) return t('channels.unsupported');
    if (!balance || balance.status === 'not_queried') return t('channels.notQueried');
    if (balance.status === 'error') return t('channels.queryFailed');
    return [...balance.balance_infos]
      .sort((a, b) => a.currency.localeCompare(b.currency))
      .map((item) => `${balanceCurrencySymbol(item.currency)}${item.total_balance}`)
      .join(' / ') || '0';
  };

  return <div class="resource-page channel-page">
    <Show when={loading()}><p class="empty-state">Loading...</p></Show>
    <Show when={!loading()}><div class="channel-card-grid">
      <button type="button" class="panel resource-add-card" aria-label={t('channels.addProvider')} onClick={openProviderPicker}>
        <header class="channel-card-head resource-add-head"><span class="resource-add-icon" aria-hidden="true">+</span><div><strong>{t('channels.addProvider')}</strong><span>{t('channels.addProviderHint')}</span></div></header>
        <div class="channel-card-metrics resource-add-metrics" aria-hidden="true"><div><span>{t('channels.protocols')}</span><strong>—</strong></div><div><span>{t('channels.models')}</span><strong>—</strong></div></div>
        <div class="channel-card-section resource-add-preview" aria-hidden="true"><span /><span /><span /></div>
        <footer class="resource-add-footer"><span><b aria-hidden="true">+</b>{t('channels.addProvider')}</span></footer>
      </button>
      <For each={channels()}>{(channel) => {
      const summary = () => summaries()[channel.id];
      return <article class="panel channel-card">
        <header class="channel-card-head"><ProviderLogo presetId={channel.preset_id} name={channelName(channel)} /><div><strong>{channelName(channel)}</strong><span>{providerTypeLabel(channel.provider_type)}</span></div><span class={`badge ${channel.status}`}>{channel.status === 'active' ? t('common.active') : t('common.disabled')}</span></header>
        <div class="channel-card-metrics"><div><span>{t('channels.balance')}</span><strong>{balanceHeadline(channel)}</strong><Show when={supportsBalance(channel)}><button title={t('channels.refreshBalance')} disabled={balanceBusy()[channel.id]} onClick={() => refreshBalance(channel)}>↻</button></Show></div><div><span>{t('channels.plan')}</span><strong class="muted-value">{t('channels.notIntegrated')}</strong></div></div>
        <div class="channel-card-section"><span class="channel-card-label">{t('channels.protocols')}</span><div class="channel-protocol-list"><For each={channel.protocols}>{(protocol) => <span>{protocolLabel(protocol.protocol)}</span>}</For></div></div>
        <div class="channel-card-section channel-model-preview"><div class="channel-card-label"><span>{t('channels.models')}</span><strong>{summary()?.available_count ?? 0}</strong></div><div><Show when={(summary()?.preview.length ?? 0) > 0} fallback={<span class="empty-preview">{summary()?.discovery_status === 'error' ? t('channels.discoveryFailed') : t('channels.notDetected')}</span>}><For each={summary()?.preview}>{(model) => <code>{model.provider_model_id}</code>}</For><Show when={(summary()?.available_count ?? 0) > 3}><span class="more-models">+{(summary()?.available_count ?? 0) - 3}</span></Show></Show></div></div>
        <footer class="channel-card-actions"><button class="primary-button" onClick={() => openDetails(channel)}>{t('channels.edit')}</button><button class="secondary-button" onClick={() => test(channel.id)}>{t('channels.test')}</button><details class="channel-more"><summary aria-label={`${channelName(channel)} ${t('channels.more')}`}><Icon name="more-horizontal" size={18} /></summary><div><button onClick={() => openDetails(channel, { refreshModels: true })}>{t('channels.refreshModels')}</button><Show when={supportsBalance(channel)}><button onClick={() => refreshBalance(channel)}>{t('channels.refreshBalance')}</button></Show><button onClick={() => toggleStatus(channel)}>{channel.status === 'active' ? t('channels.disable') : t('channels.enable')}</button><button class="danger-link" onClick={() => del(channel.id)}>{t('channels.delete')}</button></div></details></footer>
      </article>;
    }}</For></div></Show>

    <Show when={showCustom()}><div class="modal-backdrop" onClick={() => setShowCustom(false)}><form onSubmit={submitCustom} class="modal-card form-stack channel-config-modal" onClick={(event) => event.stopPropagation()}><div class="modal-title"><div><span class="eyebrow">{t('channels.eyebrowConfigure')}</span><h3>{t('channels.customTitle')}</h3><p>{t('channels.customSub')}</p></div><button type="button" onClick={() => setShowCustom(false)}>×</button></div><div class="form-grid"><label>{t('channels.name')}<input placeholder="e.g. Internal Gateway" value={cName()} onInput={(event) => { setCName(event.currentTarget.value); setCustomPreflight(null); }} required /></label><label>{t('channels.type')}<select value={cType()} onChange={(event) => { setCType(event.currentTarget.value); setCustomPreflight(null); }}><option value="openai">OpenAI</option><option value="openai_compatible">OpenAI Compatible</option></select></label><label class="form-grid-wide">{t('channels.apiKey')}<input type="password" placeholder="API Key" value={cKey()} onInput={(event) => { setCKey(event.currentTarget.value); setCustomPreflight(null); }} required /></label></div><ProtocolEditor value={cProtocols()} onChange={(protocol, update) => updateProtocolDraft(setCProtocols, protocol, update)} /><Show when={customPreflight()}>{(result) => <div class={`preflight-result ${result().status}`}><div class="preflight-result-head"><strong>{result().status === 'ok' ? `${t('channels.detected')} · ${result().models.length}` : t('channels.detectFailed')}</strong><span>{result().status === 'ok' ? t('channels.notSaved') : result().error}</span></div><Show when={result().models.length}><><div class="preflight-select-toolbar"><span>{t('channels.selected')} {customSelectedModels().size} / {result().models.length}</span><button type="button" onClick={() => setCustomSelectedModels(new Set(result().models.map((model) => model.provider_model_id)))}>{t('channels.selectAll')}</button><button type="button" onClick={() => setCustomSelectedModels(new Set<string>())}>{t('channels.deselectAll')}</button></div><div class="preflight-model-list"><For each={result().models}>{(model) => <label><input type="checkbox" checked={customSelectedModels().has(model.provider_model_id)} onChange={(event) => togglePreflightModel(setCustomSelectedModels, model.provider_model_id, event.currentTarget.checked)} /><span><strong>{model.display_name}</strong><code>{model.provider_model_id}</code></span><Show when={customSelectedModels().has(model.provider_model_id)}><PriceFields value={customPrices()[model.provider_model_id] ?? emptyPrice()} onChange={(next) => setCustomPrices((cur) => ({ ...cur, [model.provider_model_id]: next }))} /></Show></label>}</For></div></></Show></div>}</Show><Show when={cError()}><div class="form-error">{cError()}</div></Show><div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setShowCustom(false)}>{t('common.cancel')}</button><button type="button" onClick={detectCustom} disabled={cBusy() || !cName() || !cKey() || !enabledProtocols(cProtocols()).length} class="secondary-button">{cBusy() ? t('channels.detecting') : customPreflight() ? t('channels.redetect') : t('channels.detect')}</button><Show when={customPreflight()}>{(result) => <><button type="submit" data-action="save" disabled={cBusy()} class="secondary-button">{result().status === 'error' ? t('channels.saveAnyway') : t('channels.save')}</button><button type="submit" data-action="sync" disabled={cBusy() || result().status !== 'ok' || customSelectedModels().size === 0} class="primary-button">{t('channels.saveAndImport')} {customSelectedModels().size}</button></>}</Show></div></form></div></Show>

    <Show when={showProviderPicker()}><div class="modal-backdrop" onClick={() => setShowProviderPicker(false)}><div class="modal-card provider-picker-modal" onClick={(event) => event.stopPropagation()}><Show when={!selectedPreset()} fallback={<form onSubmit={submitPreset} class="form-stack"><button type="button" onClick={() => { setSelectedPreset(null); setPresetPreflight(null); setPresetSelectedModels(new Set<string>()); }} class="back-button">{t('channels.backToProviders')}</button><div class="modal-title"><div><span class="eyebrow">{t('channels.eyebrowConfigure')}</span><h3>+ {selectedPreset() ? presetName(selectedPreset()!) : ''}</h3><p>{selectedPreset()?.base_url}</p><a class="provider-doc-link" href={selectedPreset()?.docs_url} target="_blank">{t('channels.viewDocs')}</a></div></div><label>{t('channels.apiKey')}</label><input type="password" value={presetApiKey()} onInput={(event) => { setPresetApiKey(event.currentTarget.value); setPresetPreflight(null); setPresetSelectedModels(new Set<string>()); }} placeholder="sk-..." required /><ProtocolEditor value={presetProtocols()} onChange={(protocol, update) => { setPresetPreflight(null); setPresetProtocols((current) => current.map((entry) => entry.protocol === protocol ? { ...entry, ...update } : entry)); }} /><Show when={presetPreflight()}>{(result) => <div class={`preflight-result ${result().status}`}><div class="preflight-result-head"><strong>{result().status === 'ok' ? `${t('channels.detected')} · ${result().models.length}` : t('channels.detectFailed')}</strong><span>{result().status === 'ok' ? t('channels.selectModels') : result().error}</span></div><Show when={result().models.length}><><div class="preflight-select-toolbar"><span>{t('channels.selected')} {presetSelectedModels().size} / {result().models.length}</span><button type="button" onClick={() => setPresetSelectedModels(new Set(result().models.map((model) => model.provider_model_id)))}>{t('channels.selectAll')}</button><button type="button" onClick={() => setPresetSelectedModels(new Set<string>())}>{t('channels.deselectAll')}</button></div><div class="preflight-model-list"><For each={result().models}>{(model) => <label><input type="checkbox" checked={presetSelectedModels().has(model.provider_model_id)} onChange={(event) => togglePreflightModel(setPresetSelectedModels, model.provider_model_id, event.currentTarget.checked)} /><span><strong>{model.display_name}</strong><code>{model.provider_model_id}</code></span><Show when={presetSelectedModels().has(model.provider_model_id)}><PriceFields value={presetPrices()[model.provider_model_id] ?? emptyPrice()} onChange={(next) => setPresetPrices((cur) => ({ ...cur, [model.provider_model_id]: next }))} /></Show></label>}</For></div></></Show></div>}</Show><Show when={presetError()}><div class="form-error">{presetError()}</div></Show><div class="modal-actions"><button type="button" onClick={() => setShowProviderPicker(false)} class="secondary-button">{t('common.cancel')}</button><button type="button" onClick={detectPreset} disabled={presetBusy() || !presetApiKey()} class="secondary-button">{presetBusy() ? t('channels.detectingPreset') : presetPreflight() ? t('channels.redetectPreset') : t('channels.detectPreset')}</button><Show when={presetPreflight()}>{(result) => <><button type="submit" data-action="save" disabled={presetBusy()} class="secondary-button">{result().status === 'error' ? t('channels.saveAnyway') : t('channels.save')}</button><button type="submit" data-action="sync" disabled={presetBusy() || result().status !== 'ok' || presetSelectedModels().size === 0} class="primary-button">{t('channels.saveAndImport')} {presetSelectedModels().size}</button></>}</Show></div></form>}><div class="modal-title"><div><span class="eyebrow">{t('channels.eyebrowQuickConnect')}</span><h3>{t('channels.chooseProvider')}</h3><p>{t('channels.chooseProviderSub')}</p></div><button onClick={() => setShowProviderPicker(false)}>×</button></div><div class="provider-grid"><button onClick={chooseCustom} class="provider-option custom-provider-option"><div class="provider-option-top"><span class="provider-logo">+</span><div><strong>{t('channels.custom')}</strong><p>{t('channels.customDesc')}</p></div></div><div class="provider-models"><span>GET /models</span><span>{t('channels.manualAdd')}</span></div></button><For each={PROVIDER_PRESETS}>{(preset) => <button onClick={() => { setSelectedPreset(preset); setPresetApiKey(''); setPresetError(''); setPresetPreflight(null); setPresetSelectedModels(new Set<string>()); setPresetProtocols(protocolDrafts(preset.protocols, preset.base_url)); }} class="provider-option"><div class="provider-option-top"><ProviderLogo presetId={preset.id} name={presetName(preset)} /><div><strong>{presetName(preset)}</strong><p>{presetDescription(preset)}</p></div></div><div class="provider-models"><For each={preset.protocols}>{(protocol) => <span>{protocolLabel(protocol.protocol)}</span>}</For></div></button>}</For></div></Show></div></div></Show>

    <Show when={editChannel()}>{(channel) => <div class="modal-backdrop" onClick={() => setEditChannel(null)}><form class="modal-card form-stack" onSubmit={saveEdit} onClick={(event) => event.stopPropagation()}><div class="modal-title"><div><span class="eyebrow">{t('channels.eyebrowConnection')}</span><h3>{t('channels.connection')}</h3><p>{channelName(channel())}</p></div><button type="button" onClick={() => setEditChannel(null)}>×</button></div><label>{t('channels.name')}<input value={editName()} onInput={(event) => setEditName(event.currentTarget.value)} required /></label><ProtocolEditor value={editProtocols()} onChange={updateEditProtocol} /><label>{t('channels.newApiKey')}<input type="password" value={editKey()} onInput={(event) => setEditKey(event.currentTarget.value)} placeholder="-" /></label><Show when={editError()}><div class="form-error">{editError()}</div></Show><div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setEditChannel(null)}>{t('common.cancel')}</button><button type="submit" class="primary-button" disabled={editBusy()}>{editBusy() ? t('common.saving') : t('common.save')}</button></div></form></div>}</Show>

    <Show when={detailChannel()}>{(channel) => <div class="modal-backdrop" onClick={() => setDetailChannel(null)}><div class="modal-card channel-detail-modal" onClick={(event) => event.stopPropagation()}><Show when={creationResult()}><div class="creation-success" role="status" aria-live="polite"><div class="creation-success-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.3 3.3 7.7-8" /></svg><i /><i /><i /><i /></div><div><strong>{t('channels.createdTitle')}</strong><span>{t('channels.createdBody')}</span></div></div></Show><div class="modal-title"><div><span class="eyebrow">{t('channels.eyebrowChannel')}</span><h3>{channelName(channel())}</h3><p>{channel().base_url}</p></div><button onClick={() => setDetailChannel(null)}>×</button></div><div class="channel-detail-stats"><div><span>{t('channels.balance')}</span><strong>{balanceHeadline(channel())}</strong><Show when={supportsBalance(channel())}><button disabled={balanceBusy()[channel().id]} onClick={() => refreshBalance(channel())}>{t('common.refresh')}</button></Show></div><div><span>{t('channels.plan')}</span><strong>{t('channels.notIntegrated')}</strong></div><div><span>{t('channels.models')}</span><strong>{inventory().filter((model) => model.availability === 'available').length}</strong></div></div><div class="detail-protocol-row"><div><span class="channel-card-label">{t('channels.nativeProtocols')}</span><div class="channel-protocols"><For each={channel().protocols}>{(protocol) => <span>{protocolLabel(protocol.protocol)}</span>}</For></div></div><button class="secondary-button" onClick={() => openEditor(channel())}>{t('channels.connection')}</button></div><div class="catalog-toolbar"><input placeholder={t('common.search')} value={inventoryFilter()} onInput={(event) => setInventoryFilter(event.currentTarget.value)} /><button class="secondary-button" disabled={inventoryBusy()} onClick={() => loadInventory(channel(), true)}>{inventoryBusy() ? t('channels.detecting') : t('channels.refreshModels')}</button></div><Show when={discovery()}>{(state) => <div class={`discovery-note ${state().status}`}><span>{state().status === 'ok' ? `${t('channels.discovered')} ${state().model_count}` : state().status === 'error' ? t('channels.discoveryFailed') : t('channels.notDetected')}</span><Show when={state().last_success_at}><small>{new Date(state().last_success_at! * 1000).toLocaleString()}</small></Show></div>}</Show><Show when={inventoryError()}><div class="form-error">{inventoryError()}</div></Show><form class="catalog-manual" onSubmit={addManualModel}><input placeholder={t('channels.manualAddModel')} value={manualModel()} onInput={(event) => setManualModel(event.currentTarget.value)} /><button class="secondary-button" type="submit">{t('channels.add')}</button></form><div class="catalog-list"><Show when={!inventoryBusy() && filteredInventory().length === 0}><div class="empty-state"><h3>{t('channels.noModels')}</h3><p>{t('channels.noModelsBody')}</p></div></Show><For each={filteredInventory()}>{(model) => <div class={`catalog-row ${model.availability}`}><input type="checkbox" disabled={Boolean(model.imported_model_card_id) || model.availability === 'missing'} checked={selectedModels().has(model.provider_model_id)} onChange={(event) => toggleModel(model.provider_model_id, event.currentTarget.checked)} /><div class="catalog-model-copy"><strong>{model.display_name}</strong><code>{model.provider_model_id}</code><span>{model.source === 'manual' ? t('channels.manual') : t('channels.providerDiscovered')} · {model.availability === 'missing' ? t('channels.missing') : t('channels.available')}</span></div><Show when={selectedModels().has(model.provider_model_id)}><label class="catalog-id-field">{t('channels.unifiedModelId')}<input value={suggestedIds()[model.provider_model_id] ?? model.provider_model_id} onInput={(event) => setSuggestedIds((current) => ({ ...current, [model.provider_model_id]: event.currentTarget.value }))} /></label></Show><Show when={model.imported_model_card_id} fallback={<button class="catalog-delete" title={t('channels.removeFromInventory')} onClick={() => removeInventoryModel(model.provider_model_id)}>×</button>}><span class="badge active">{t('channels.imported')}</span></Show></div>}</For></div><div class="modal-actions catalog-actions"><span>{selectedModels().size} {t('channels.pendingImport')}</span><button class="secondary-button" onClick={() => setDetailChannel(null)}>{t('common.close')}</button><button class="primary-button" disabled={!selectedModels().size || inventoryBusy()} onClick={importSelected}>{t('channels.importAs')}</button></div></div></div>}</Show>
  </div>;
}
