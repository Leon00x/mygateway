import { createMemo, createSignal, onMount, For, Show } from 'solid-js';
import { PROVIDER_PRESETS, type ProviderPreset } from '../presets';
import { ProviderLogo } from '../components/ProviderLogo';
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
}

interface ChannelPreflight {
  status: 'ok' | 'error';
  models: PreflightModel[];
  error?: string;
}

const protocolLabel = (protocol: string) => ({
  openai_chat: 'Chat', openai_responses: 'Responses', anthropic_messages: 'Messages',
}[protocol] ?? protocol);

export default function Channels() {
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [summaries, setSummaries] = createSignal<Record<string, ChannelSummary>>({});
  const [balances, setBalances] = createSignal<Record<string, ProviderBalance>>({});
  const [loading, setLoading] = createSignal(true);
  const [query, setQuery] = createSignal('');
  const [balanceBusy, setBalanceBusy] = createSignal<Record<string, boolean>>({});

  const [showProviderPicker, setShowProviderPicker] = createSignal(false);
  const [selectedPreset, setSelectedPreset] = createSignal<ProviderPreset | null>(null);
  const [presetApiKey, setPresetApiKey] = createSignal('');
  const [presetError, setPresetError] = createSignal('');
  const [presetBusy, setPresetBusy] = createSignal(false);
  const [presetPreflight, setPresetPreflight] = createSignal<ChannelPreflight | null>(null);
  const [presetSelectedModels, setPresetSelectedModels] = createSignal<Set<string>>(new Set());

  const [showCustom, setShowCustom] = createSignal(false);
  const [cName, setCName] = createSignal('');
  const [cType, setCType] = createSignal('openai_compatible');
  const [cUrl, setCUrl] = createSignal('');
  const [cKey, setCKey] = createSignal('');
  const [cProtocols, setCProtocols] = createSignal<string[]>(['openai_chat']);
  const [cError, setCErr] = createSignal('');
  const [cBusy, setCBusy] = createSignal(false);
  const [customPreflight, setCustomPreflight] = createSignal<ChannelPreflight | null>(null);
  const [customSelectedModels, setCustomSelectedModels] = createSignal<Set<string>>(new Set());

  const [editChannel, setEditChannel] = createSignal<Channel | null>(null);
  const [editName, setEditName] = createSignal('');
  const [editKey, setEditKey] = createSignal('');
  const [editProtocols, setEditProtocols] = createSignal<ChannelProtocol[]>([]);
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

  const filteredChannels = createMemo(() => {
    const value = query().trim().toLowerCase();
    if (!value) return channels();
    return channels().filter((channel) => `${channel.name} ${channel.provider_type} ${channel.base_url}`.toLowerCase().includes(value));
  });

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
    if (!impactResponse.ok) { alert('无法读取渠道关联关系，请稍后重试。'); return; }
    const impact = await impactResponse.json() as ChannelDeleteImpact;
    const orphanPreview = impact.models.filter((model) => model.will_delete_model)
      .slice(0, 5).map((model) => model.unified_model_id).join('、');
    const message = impact.instance_count === 0
      ? '该渠道没有关联模型。确定删除渠道？'
      : `该渠道关联 ${impact.instance_count} 个实例、${impact.affected_model_count} 个统一模型。\n`
        + `${impact.orphan_model_count} 个模型将失去最后渠道并一并删除${orphanPreview ? `：${orphanPreview}` : ''}。\n`
        + '其他仍有渠道的模型只移除当前实例。历史用量不会删除。\n\n确定继续？';
    if (!confirm(message)) return;
    const response = await fetch(`/admin/api/channels/${id}`, { method: 'DELETE' });
    if (!response.ok) alert('删除失败');
    else forgetProviderBalance(id);
    await loadOverview();
  };

  const test = async (id: string) => {
    const response = await fetch(`/admin/api/channels/${id}/test`, { method: 'POST' });
    const data = await response.json();
    alert(data.ok ? `✓ Connected (${data.elapsed_ms}ms)` : `✗ ${data.error ?? 'Failed'} (${data.elapsed_ms ?? '?'}ms)`);
  };

  const openProviderPicker = () => {
    setSelectedPreset(null); setPresetApiKey(''); setPresetError(''); setPresetPreflight(null); setPresetSelectedModels(new Set()); setShowProviderPicker(true);
  };

  const chooseCustom = () => {
    setShowProviderPicker(false); setSelectedPreset(null); setShowCustom(true); setCErr(''); setCustomPreflight(null); setCustomSelectedModels(new Set());
  };

  const applyInventory = (data: { models?: InventoryModel[]; discovery?: DiscoveryState }) => {
    const models = data.models ?? [];
    setInventory(models); if (data.discovery) setDiscovery(data.discovery);
    setSuggestedIds(Object.fromEntries(models.map((model) => [model.provider_model_id, model.provider_model_id])));
    setSelectedModels(new Set());
  };

  const loadInventory = async (channel: Channel, refreshNow: boolean) => {
    setInventoryBusy(true); setInventoryError('');
    try {
      const suffix = refreshNow ? '/refresh' : '';
      const response = await fetch(`/admin/api/channels/${channel.id}/models${suffix}`, {
        method: refreshNow ? 'POST' : 'GET',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? '模型检测失败');
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
    setPresetBusy(true); setPresetError(''); setPresetPreflight(null); setPresetSelectedModels(new Set());
    try {
      const response = await fetch('/admin/api/channels/preflight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: presetApiKey(), preset_id: preset.id }),
      });
      const data = await response.json();
      if (response.ok) {
        const models = data.models ?? [];
        setPresetPreflight({ status: 'ok', models });
        setPresetSelectedModels(new Set(models.map((model: PreflightModel) => model.provider_model_id)));
      }
      else if (response.status === 502) setPresetPreflight({ status: 'error', models: [], error: data.error?.message ?? '检测失败' });
      else setPresetError(data.error?.message ?? '连接信息无效');
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
          api_key: presetApiKey(), preset_id: preset.id,
          ...(preflight.status === 'ok' ? { detected_models: preflight.models } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? '添加失败');
      setShowProviderPicker(false); setSelectedPreset(null); setPresetApiKey(''); setPresetPreflight(null); setPresetSelectedModels(new Set());
      await openDetails(data as Channel, { created: true, importModelIds });
    } catch (error) { setPresetError((error as Error).message); }
    finally { setPresetBusy(false); }
  };

  const customPayload = () => ({
    name: cName(), provider_type: cType(), base_url: cUrl(), api_key: cKey(),
    protocols: cProtocols().map((protocol) => ({
      protocol, base_url: cUrl(), auth_scheme: protocol === 'anthropic_messages' ? 'x_api_key' : 'bearer',
      ...(protocol === 'anthropic_messages' ? { api_version: '2023-06-01' } : {}),
    })),
  });

  const detectCustom = async () => {
    if (!cName() || !cUrl() || !cKey() || !cProtocols().length) return;
    setCBusy(true); setCErr(''); setCustomPreflight(null); setCustomSelectedModels(new Set());
    try {
      const response = await fetch('/admin/api/channels/preflight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(customPayload()),
      });
      const data = await response.json();
      if (response.ok) {
        const models = data.models ?? [];
        setCustomPreflight({ status: 'ok', models });
        setCustomSelectedModels(new Set(models.map((model: PreflightModel) => model.provider_model_id)));
      }
      else if (response.status === 502) setCustomPreflight({ status: 'error', models: [], error: data.error?.message ?? '检测失败' });
      else setCErr(data.error?.message ?? '连接信息无效');
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
      if (!response.ok) throw new Error(data.error?.message ?? '创建失败');
      setShowCustom(false); setCName(''); setCUrl(''); setCKey(''); setCProtocols(['openai_chat']); setCustomPreflight(null); setCustomSelectedModels(new Set());
      await openDetails(data as Channel, { created: true, importModelIds });
    } catch (error) { setCErr((error as Error).message); }
    finally { setCBusy(false); }
  };

  const toggleCustomProtocol = (protocol: string, checked: boolean) => {
    setCustomPreflight(null);
    setCProtocols((current) => checked ? [...new Set([...current, protocol])] : current.filter((item) => item !== protocol));
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
    setDetailChannel(null); setEditChannel(channel); setEditName(channel.name); setEditKey('');
    setEditProtocols(channel.protocols.map((protocol) => ({ ...protocol }))); setEditError('');
  };

  const saveEdit = async (event: Event) => {
    event.preventDefault(); const channel = editChannel(); if (!channel) return;
    setEditBusy(true); setEditError('');
    try {
      const protocols = editProtocols();
      const body: Record<string, unknown> = channel.preset_id
        ? { name: editName() }
        : { name: editName(), base_url: protocols[0]?.base_url ?? channel.base_url, protocols };
      if (editKey()) body.api_key = editKey();
      const response = await fetch(`/admin/api/channels/${channel.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? '保存失败');
      forgetProviderBalance(channel.id);
      setEditChannel(null); await loadOverview(); await openDetails(data as Channel);
    } catch (error) { setEditError((error as Error).message); }
    finally { setEditBusy(false); }
  };

  const updateEditProtocol = (index: number, value: string) => {
    setEditProtocols((current) => current.map((protocol, itemIndex) => itemIndex === index ? { ...protocol, base_url: value } : protocol));
  };

  const addManualModel = async (event: Event) => {
    event.preventDefault(); const channel = detailChannel(); if (!channel || !manualModel().trim()) return;
    const response = await fetch(`/admin/api/channels/${channel.id}/models`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_id: manualModel().trim() }),
    });
    const data = await response.json();
    if (response.ok) { applyInventory({ models: data.models }); setManualModel(''); await loadOverview(); }
  };

  const removeInventoryModel = async (modelId: string) => {
    const channel = detailChannel(); if (!channel || !confirm(`从渠道库存移除 ${modelId}？`)) return;
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
      for (let offset = 0; offset < requested.length; offset += 100) {
        const response = await fetch(`/admin/api/channels/${channel.id}/models/import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ models: requested.slice(offset, offset + 100) }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? '导入失败');
        failures.push(...(data.results ?? []).filter((result: { ok: boolean }) => !result.ok));
        applyInventory({ models: data.models });
      }
      await loadOverview();
      if (failures.length) setInventoryError(`${failures.length} 个模型未能导入，请检查标识冲突。`);
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
    if (!supportsBalance(channel)) return '暂不支持';
    if (!balance || balance.status === 'not_queried') return '尚未查询';
    if (balance.status === 'error') return '查询失败';
    return [...balance.balance_infos]
      .sort((a, b) => a.currency.localeCompare(b.currency))
      .map((item) => `${balanceCurrencySymbol(item.currency)}${item.total_balance}`)
      .join(' / ') || '0';
  };

  return <div class="resource-page channel-page">
    <div class="page-heading">
      <div><h2>供应商渠道</h2><p>集中管理接入协议、账户余额与可用模型。</p></div>
      <button onClick={openProviderPicker} class="primary-button">+ 添加供应商</button>
    </div>

    <div class="channel-list-toolbar"><div><strong>已连接渠道</strong><span>{channels().length} 个供应商配置</span></div><input placeholder="搜索渠道" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} /></div>
    <Show when={loading()}><p class="empty-state">Loading...</p></Show>
    <Show when={!loading() && channels().length === 0}><div class="panel empty-state"><span class="provider-logo">+</span><h3>还没有渠道</h3><p>添加供应商后即可检测并导入模型。</p></div></Show>

    <div class="channel-card-grid"><For each={filteredChannels()}>{(channel) => {
      const summary = () => summaries()[channel.id];
      return <article class="panel channel-card">
        <header class="channel-card-head"><ProviderLogo presetId={channel.preset_id} name={channel.name} /><div><strong>{channel.name}</strong><span>{channel.provider_type.replace('_', ' ')}</span></div><span class={`badge ${channel.status}`}>{channel.status === 'active' ? '运行中' : '已停用'}</span></header>
        <div class="channel-card-metrics"><div><span>账户余额</span><strong>{balanceHeadline(channel)}</strong><Show when={supportsBalance(channel)}><button title="刷新余额" disabled={balanceBusy()[channel.id]} onClick={() => refreshBalance(channel)}>↻</button></Show></div><div><span>套餐余量</span><strong class="muted-value">暂未接入</strong></div></div>
        <div class="channel-card-section"><span class="channel-card-label">接入协议</span><div class="channel-protocols"><For each={channel.protocols}>{(protocol) => <span>{protocolLabel(protocol.protocol)}</span>}</For></div></div>
        <div class="channel-card-section channel-model-preview"><div class="channel-card-label"><span>支持模型</span><strong>{summary()?.available_count ?? 0} 个</strong></div><div><Show when={(summary()?.preview.length ?? 0) > 0} fallback={<span class="empty-preview">{summary()?.discovery_status === 'error' ? '检测失败，可进入编辑手工添加' : '尚未检测模型'}</span>}><For each={summary()?.preview}>{(model) => <code>{model.provider_model_id}</code>}</For><Show when={(summary()?.available_count ?? 0) > 3}><span class="more-models">+{(summary()?.available_count ?? 0) - 3}</span></Show></Show></div></div>
        <footer class="channel-card-actions"><button class="primary-button" onClick={() => openDetails(channel)}>编辑</button><button class="secondary-button" onClick={() => test(channel.id)}>测试</button><details class="channel-more"><summary aria-label={`${channel.name} 更多操作`}>•••</summary><div><button onClick={() => openDetails(channel, { refreshModels: true })}>刷新模型</button><Show when={supportsBalance(channel)}><button onClick={() => refreshBalance(channel)}>刷新余额</button></Show><button onClick={() => toggleStatus(channel)}>{channel.status === 'active' ? '停用渠道' : '启用渠道'}</button><button class="danger-link" onClick={() => del(channel.id)}>删除渠道</button></div></details></footer>
      </article>;
    }}</For></div>

    <Show when={showCustom()}><form onSubmit={submitCustom} class="panel inline-form"><div class="inline-form-title"><div><h3>自定义渠道</h3><p>先检测连接和 GET /models；检测阶段不会创建渠道。</p></div><button type="button" onClick={() => setShowCustom(false)}>×</button></div><div class="form-grid"><label>渠道名称<input placeholder="例如 Internal Gateway" value={cName()} onInput={(event) => { setCName(event.currentTarget.value); setCustomPreflight(null); }} required /></label><label>渠道类型<select value={cType()} onChange={(event) => { setCType(event.currentTarget.value); setCustomPreflight(null); }}><option value="openai">OpenAI</option><option value="openai_compatible">OpenAI Compatible</option></select></label><label>Base URL<input placeholder="https://.../v1" value={cUrl()} onInput={(event) => { setCUrl(event.currentTarget.value); setCustomPreflight(null); }} required /></label><label>API Key<input type="password" placeholder="API Key" value={cKey()} onInput={(event) => { setCKey(event.currentTarget.value); setCustomPreflight(null); }} required /></label></div><div class="protocol-options"><strong>原生协议</strong><For each={['openai_chat', 'openai_responses', 'anthropic_messages']}>{(protocol) => <label class="checkbox-label"><input type="checkbox" checked={cProtocols().includes(protocol)} onChange={(event) => toggleCustomProtocol(protocol, event.currentTarget.checked)} />{protocolLabel(protocol)}</label>}</For></div><Show when={customPreflight()}>{(result) => <div class={`preflight-result ${result().status}`}><div class="preflight-result-head"><strong>{result().status === 'ok' ? `检测成功 · ${result().models.length} 个模型` : '检测未通过'}</strong><span>{result().status === 'ok' ? '连接信息尚未保存' : result().error}</span></div><Show when={result().models.length}><><div class="preflight-select-toolbar"><span>已选 {customSelectedModels().size} / {result().models.length}</span><button type="button" onClick={() => setCustomSelectedModels(new Set(result().models.map((model) => model.provider_model_id)))}>全选</button><button type="button" onClick={() => setCustomSelectedModels(new Set())}>取消全选</button></div><div class="preflight-model-list"><For each={result().models}>{(model) => <label><input type="checkbox" checked={customSelectedModels().has(model.provider_model_id)} onChange={(event) => togglePreflightModel(setCustomSelectedModels, model.provider_model_id, event.currentTarget.checked)} /><span><strong>{model.display_name}</strong><code>{model.provider_model_id}</code></span></label>}</For></div></></Show></div>}</Show><Show when={cError()}><div class="form-error">{cError()}</div></Show><div class="inline-form-actions"><button type="button" onClick={detectCustom} disabled={cBusy() || !cName() || !cUrl() || !cKey() || !cProtocols().length} class="secondary-button">{cBusy() ? '检测中…' : customPreflight() ? '重新检测连接与模型' : '检测连接与模型'}</button><Show when={customPreflight()}>{(result) => <><button type="submit" data-action="save" disabled={cBusy()} class="secondary-button">{result().status === 'error' ? '仍然保存' : '保存'}</button><button type="submit" data-action="sync" disabled={cBusy() || result().status !== 'ok' || customSelectedModels().size === 0} class="primary-button">保存并导入 {customSelectedModels().size} 个模型</button></>}</Show></div></form></Show>

    <Show when={showProviderPicker()}><div class="modal-backdrop" onClick={() => setShowProviderPicker(false)}><div class="modal-card provider-picker-modal" onClick={(event) => event.stopPropagation()}><Show when={!selectedPreset()} fallback={<form onSubmit={submitPreset} class="form-stack"><button type="button" onClick={() => { setSelectedPreset(null); setPresetPreflight(null); setPresetSelectedModels(new Set()); }} class="back-button">← 返回供应商列表</button><div class="modal-title"><div><span class="eyebrow">Configure</span><h3>添加 {selectedPreset()?.name}</h3><p>{selectedPreset()?.base_url}</p><a class="provider-doc-link" href={selectedPreset()?.docs_url} target="_blank">查看官方文档 ↗</a></div></div><label>API Key</label><input type="password" value={presetApiKey()} onInput={(event) => { setPresetApiKey(event.currentTarget.value); setPresetPreflight(null); setPresetSelectedModels(new Set()); }} placeholder="sk-..." required /><div class="preset-protocol-note"><strong>自动接入协议</strong><div class="channel-protocols"><For each={selectedPreset()?.protocols}>{(protocol) => <span>{protocolLabel(protocol.protocol)}</span>}</For></div><small>协议来自服务端预置，不会根据模型列表猜测。</small></div><Show when={presetPreflight()}>{(result) => <div class={`preflight-result ${result().status}`}><div class="preflight-result-head"><strong>{result().status === 'ok' ? `检测成功 · ${result().models.length} 个模型` : '检测未通过'}</strong><span>{result().status === 'ok' ? '请选择需要立即导入网关的模型，当前尚未创建渠道。' : result().error}</span></div><Show when={result().models.length}><><div class="preflight-select-toolbar"><span>已选 {presetSelectedModels().size} / {result().models.length}</span><button type="button" onClick={() => setPresetSelectedModels(new Set(result().models.map((model) => model.provider_model_id)))}>全选</button><button type="button" onClick={() => setPresetSelectedModels(new Set())}>取消全选</button></div><div class="preflight-model-list"><For each={result().models}>{(model) => <label><input type="checkbox" checked={presetSelectedModels().has(model.provider_model_id)} onChange={(event) => togglePreflightModel(setPresetSelectedModels, model.provider_model_id, event.currentTarget.checked)} /><span><strong>{model.display_name}</strong><code>{model.provider_model_id}</code></span></label>}</For></div></></Show></div>}</Show><Show when={presetError()}><div class="form-error">{presetError()}</div></Show><div class="modal-actions"><button type="button" onClick={() => setShowProviderPicker(false)} class="secondary-button">取消</button><button type="button" onClick={detectPreset} disabled={presetBusy() || !presetApiKey()} class="secondary-button">{presetBusy() ? '检测中…' : presetPreflight() ? '重新检测连接与模型' : '检测连接与模型'}</button><Show when={presetPreflight()}>{(result) => <><button type="submit" data-action="save" disabled={presetBusy()} class="secondary-button">{result().status === 'error' ? '仍然保存' : '保存'}</button><button type="submit" data-action="sync" disabled={presetBusy() || result().status !== 'ok' || presetSelectedModels().size === 0} class="primary-button">保存并导入 {presetSelectedModels().size} 个模型</button></>}</Show></div></form>}><div class="modal-title"><div><span class="eyebrow">Quick connect</span><h3>选择供应商</h3><p>预置渠道只需一个 Key，协议由系统自动配置。</p></div><button onClick={() => setShowProviderPicker(false)}>×</button></div><div class="provider-grid"><button onClick={chooseCustom} class="provider-option custom-provider-option"><div class="provider-option-top"><span class="provider-logo">+</span><div><strong>自定义渠道</strong><p>连接任意 OpenAI Compatible 或 Messages 端点</p></div></div><div class="provider-models"><span>GET /models</span><span>可手工补充</span></div></button><For each={PROVIDER_PRESETS}>{(preset) => <button onClick={() => { setSelectedPreset(preset); setPresetApiKey(''); setPresetError(''); setPresetPreflight(null); setPresetSelectedModels(new Set()); }} class="provider-option"><div class="provider-option-top"><ProviderLogo presetId={preset.id} name={preset.name} /><div><strong>{preset.name}</strong><p>{preset.description}</p></div></div><div class="provider-models"><For each={preset.protocols}>{(protocol) => <span>{protocolLabel(protocol.protocol)}</span>}</For></div></button>}</For></div></Show></div></div></Show>

    <Show when={editChannel()}>{(channel) => <div class="modal-backdrop" onClick={() => setEditChannel(null)}><form class="modal-card form-stack" onSubmit={saveEdit} onClick={(event) => event.stopPropagation()}><div class="modal-title"><div><span class="eyebrow">Connection</span><h3>连接配置</h3><p>{channel().name}</p></div><button type="button" onClick={() => setEditChannel(null)}>×</button></div><label>渠道名称<input value={editName()} onInput={(event) => setEditName(event.currentTarget.value)} required /></label><Show when={channel().preset_id} fallback={<For each={editProtocols()}>{(protocol, index) => <label>{protocolLabel(protocol.protocol)} Base URL<input value={protocol.base_url} onInput={(event) => updateEditProtocol(index(), event.currentTarget.value)} required /></label>}</For>}><div class="preset-protocol-note preset-endpoints"><strong>预置支持协议</strong><For each={channel().protocols}>{(protocol) => <div><span>{protocolLabel(protocol.protocol)}</span><code>{protocol.base_url}</code></div>}</For><small>预置端点由服务端维护。如需自定义地址，请创建自定义渠道。</small></div></Show><label>新 API Key（留空保持不变）<input type="password" value={editKey()} onInput={(event) => setEditKey(event.currentTarget.value)} placeholder="不修改" /></label><Show when={editError()}><div class="form-error">{editError()}</div></Show><div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setEditChannel(null)}>取消</button><button type="submit" class="primary-button" disabled={editBusy()}>{editBusy() ? '保存中…' : '保存'}</button></div></form></div>}</Show>

    <Show when={detailChannel()}>{(channel) => <div class="modal-backdrop" onClick={() => setDetailChannel(null)}><div class="modal-card channel-detail-modal" onClick={(event) => event.stopPropagation()}><Show when={creationResult()}><div class="creation-success" role="status" aria-live="polite"><div class="creation-success-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.3 3.3 7.7-8" /></svg><i /><i /><i /><i /></div><div><strong>渠道添加完成</strong><span>连接配置已安全保存，可以继续管理模型。</span></div></div></Show><div class="modal-title"><div><span class="eyebrow">Channel detail</span><h3>{channel().name}</h3><p>{channel().base_url}</p></div><button onClick={() => setDetailChannel(null)}>×</button></div><div class="channel-detail-stats"><div><span>账户余额</span><strong>{balanceHeadline(channel())}</strong><Show when={supportsBalance(channel())}><button disabled={balanceBusy()[channel().id]} onClick={() => refreshBalance(channel())}>刷新</button></Show></div><div><span>套餐余量</span><strong>暂未接入</strong></div><div><span>支持模型</span><strong>{inventory().filter((model) => model.availability === 'available').length} 个</strong></div></div><div class="detail-protocol-row"><div><span class="channel-card-label">原生协议</span><div class="channel-protocols"><For each={channel().protocols}>{(protocol) => <span>{protocolLabel(protocol.protocol)}</span>}</For></div></div><button class="secondary-button" onClick={() => openEditor(channel())}>修改连接配置</button></div><div class="catalog-toolbar"><input placeholder="搜索模型" value={inventoryFilter()} onInput={(event) => setInventoryFilter(event.currentTarget.value)} /><button class="secondary-button" disabled={inventoryBusy()} onClick={() => loadInventory(channel(), true)}>{inventoryBusy() ? '检测中…' : '刷新模型'}</button></div><Show when={discovery()}>{(state) => <div class={`discovery-note ${state().status}`}><span>{state().status === 'ok' ? `已发现 ${state().model_count} 个模型` : state().status === 'error' ? '最近检测失败，可手工补充' : '尚未检测'}</span><Show when={state().last_success_at}><small>上次成功 {new Date(state().last_success_at! * 1000).toLocaleString()}</small></Show></div>}</Show><Show when={inventoryError()}><div class="form-error">{inventoryError()}</div></Show><form class="catalog-manual" onSubmit={addManualModel}><input placeholder="手工增加上游模型 ID" value={manualModel()} onInput={(event) => setManualModel(event.currentTarget.value)} /><button class="secondary-button" type="submit">添加</button></form><div class="catalog-list"><Show when={!inventoryBusy() && filteredInventory().length === 0}><div class="empty-state"><h3>没有模型</h3><p>刷新供应商或手工增加模型 ID。</p></div></Show><For each={filteredInventory()}>{(model) => <div class={`catalog-row ${model.availability}`}><input type="checkbox" disabled={Boolean(model.imported_model_card_id) || model.availability === 'missing'} checked={selectedModels().has(model.provider_model_id)} onChange={(event) => toggleModel(model.provider_model_id, event.currentTarget.checked)} /><div class="catalog-model-copy"><strong>{model.display_name}</strong><code>{model.provider_model_id}</code><span>{model.source === 'manual' ? '手工' : '供应商发现'} · {model.availability === 'missing' ? '供应商未再返回' : '可用'}</span></div><Show when={selectedModels().has(model.provider_model_id)}><label class="catalog-id-field">统一模型 ID<input value={suggestedIds()[model.provider_model_id] ?? model.provider_model_id} onInput={(event) => setSuggestedIds((current) => ({ ...current, [model.provider_model_id]: event.currentTarget.value }))} /></label></Show><Show when={model.imported_model_card_id} fallback={<button class="catalog-delete" title="从库存移除" onClick={() => removeInventoryModel(model.provider_model_id)}>×</button>}><span class="badge active">已导入</span></Show></div>}</For></div><div class="modal-actions catalog-actions"><span>{selectedModels().size} 个待导入</span><button class="secondary-button" onClick={() => setDetailChannel(null)}>关闭</button><button class="primary-button" disabled={!selectedModels().size || inventoryBusy()} onClick={importSelected}>导入为网关模型</button></div></div></div>}</Show>
  </div>;
}
