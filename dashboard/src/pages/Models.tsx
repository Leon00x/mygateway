import { createSignal, onMount, For, Show } from 'solid-js';
import { COMMON_MODEL_TEMPLATES } from '../presets';

interface Channel {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  status: string;
  preset_id: string | null;
  short_code: string | null;
}

interface ProviderModel {
  provider_model_id: string;
  display_name: string;
  availability: 'available' | 'missing' | 'unknown';
}

interface Instance {
  id: string;
  channel_id: string;
  channel_model_id: string;
  public_model_alias: string;
  sort_order: number;
  status: string;
  supports_stream_usage: number;
}

interface ModelCard {
  id: string;
  unified_model_id: string;
  display_name: string;
  status: string;
  instances: Instance[];
}

export default function Models() {
  const [cards, setCards] = createSignal<ModelCard[]>([]);
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [loading, setLoading] = createSignal(true);

  // Create card form
  const [showCreate, setShowCreate] = createSignal(false);
  const [newModelId, setNewModelId] = createSignal('');
  const [newDisplayName, setNewDisplayName] = createSignal('');
  const [createError, setCreateError] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [newChannelId, setNewChannelId] = createSignal('');
  const [newUpstreamModel, setNewUpstreamModel] = createSignal('');
  const [channelInventory, setChannelInventory] = createSignal<Record<string, ProviderModel[]>>({});
  const [inventoryLoading, setInventoryLoading] = createSignal(false);

  // Add instance — which card is expanded
  const [expandedCard, setExpandedCard] = createSignal<string | null>(null);
  const [addForCard, setAddForCard] = createSignal<string | null>(null);
  const [instChannelId, setInstChannelId] = createSignal('');
  const [instUpstreamModel, setInstUpstreamModel] = createSignal('');
  const [instAlias, setInstAlias] = createSignal('');
  const [instStreamUsage, setInstStreamUsage] = createSignal(true);
  const [instError, setInstError] = createSignal('');
  const [instBusy, setInstBusy] = createSignal(false);

  const fetchAll = async () => {
    try {
      const [m, c] = await Promise.all([
        fetch('/admin/api/models').then((r) => r.json()),
        fetch('/admin/api/channels').then((r) => r.json()),
      ]);
      setCards(m);
      setChannels(c);
    } catch {}
    setLoading(false);
  };

  onMount(fetchAll);

  const activeChannels = () => channels().filter((c) => c.status === 'active');

  const loadChannelInventory = async (channelId: string) => {
    if (!channelId || channelInventory()[channelId]) return;
    setInventoryLoading(true);
    try {
      const response = await fetch(`/admin/api/channels/${channelId}/models`);
      if (response.ok) {
        const data = await response.json() as { models?: ProviderModel[] };
        setChannelInventory((current) => ({ ...current, [channelId]: data.models ?? [] }));
      }
    } finally { setInventoryLoading(false); }
  };

  const availableInventory = (channelId: string) => (channelInventory()[channelId] ?? [])
    .filter((model) => model.availability !== 'missing');

  const chooseCreateChannel = (channelId: string) => {
    setNewChannelId(channelId); setNewUpstreamModel('');
    void loadChannelInventory(channelId);
  };

  const chooseInstanceChannel = (channelId: string) => {
    setInstChannelId(channelId); setInstUpstreamModel('');
    void loadChannelInventory(channelId);
  };

  const channelName = (id: string) => channels().find((c) => c.id === id)?.name ?? id.slice(0, 8);

  const suggestedAlias = (channelId: string, modelId: string) => {
    const channel = channels().find((item) => item.id === channelId);
    const prefix = channel?.short_code || channel?.name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 6) || 'custom';
    const token = channelId.replace(/-/g, '').slice(0, 6).toLowerCase();
    const model = modelId.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._:/-]+/g, '-');
    return model ? `${prefix}-${token}-${model}` : '';
  };

  // --- Create card ---
  const submitCreate = async (e: Event) => {
    e.preventDefault();
    if (!newModelId() || !newDisplayName()) return;
    setCreating(true);
    setCreateError('');
    try {
      const resp = await fetch('/admin/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unified_model_id: newModelId(), display_name: newDisplayName(),
          ...(newChannelId() && newUpstreamModel()
            ? { channel_id: newChannelId(), channel_model_id: newUpstreamModel() } : {}),
        }),
      });
      if (resp.ok) {
        setShowCreate(false);
        setNewModelId('');
        setNewDisplayName('');
        setNewChannelId('');
        setNewUpstreamModel('');
        fetchAll();
      } else {
        const data = await resp.json();
        setCreateError(data.error?.message ?? 'Failed');
      }
    } catch (e: any) { setCreateError(e.message); }
    setCreating(false);
  };

  // --- Add instance ---
  const openAdd = (card: ModelCard) => {
    setAddForCard(card.id);
    setInstChannelId(activeChannels()[0]?.id ?? '');
    setInstUpstreamModel('');
    setInstAlias('');
    setInstStreamUsage(true);
    setInstError('');
    if (activeChannels()[0]?.id) void loadChannelInventory(activeChannels()[0].id);
  };

  const submitInstance = async (e: Event) => {
    e.preventDefault();
    const cardId = addForCard();
    if (!cardId || !instChannelId() || !instUpstreamModel() || !instAlias()) return;
    setInstBusy(true);
    setInstError('');
    try {
      const resp = await fetch(`/admin/api/models/${cardId}/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: instChannelId(),
          channel_model_id: instUpstreamModel(),
          public_model_alias: instAlias(),
          supports_stream_usage: instStreamUsage(),
        }),
      });
      if (resp.ok) {
        setAddForCard(null);
        fetchAll();
      } else {
        const data = await resp.json();
        setInstError(data.error?.message ?? 'Failed');
      }
    } catch (e: any) { setInstError(e.message); }
    setInstBusy(false);
  };

  // --- Reorder (up/down buttons) ---
  const move = async (card: ModelCard, inst: Instance, dir: -1 | 1) => {
    const sorted = [...card.instances].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((i) => i.id === inst.id);
    const target = idx + dir;
    if (target < 0 || target >= sorted.length) return;
    const newOrder = [...sorted];
    const [item] = newOrder.splice(idx, 1);
    newOrder.splice(target, 0, item);
    await fetch(`/admin/api/models/${card.id}/instances/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_ids: newOrder.map((i) => i.id) }),
    });
    fetchAll();
  };

  // --- Delete card ---
  const deleteCard = async (id: string) => {
    if (!confirm('Delete this model card and all its instances?')) return;
    const resp = await fetch(`/admin/api/models/${id}`, { method: 'DELETE' });
    if (!resp.ok) alert('Delete failed');
    fetchAll();
  };

  return (
    <div class="resource-page">
      <div class="page-heading">
        <div><h2>Unified Models</h2><p>一个模型 ID 可以绑定多个渠道，并按顺序自动回退。</p></div>
        <button
          onClick={() => setShowCreate(!showCreate())}
          class="primary-button"
        >
          + 创建模型
        </button>
      </div>

      {/* Create card form */}
      <Show when={showCreate()}>
        <form onSubmit={submitCreate} class="panel inline-form form-stack">
          <div class="inline-form-title"><div><h3>创建统一模型</h3><p>客户端将使用统一模型 ID 发起调用。</p></div><button type="button" onClick={() => setShowCreate(false)}>×</button></div>
          <input
            placeholder="统一模型 ID (如 deepseek-chat)"
            list="common-model-templates"
            value={newModelId()}
            onInput={(e) => {
              const value = e.currentTarget.value; setNewModelId(value);
              if (!newDisplayName()) setNewDisplayName(value.replace(/[-_/]+/g, ' '));
            }}
            required
          />
          <datalist id="common-model-templates"><For each={COMMON_MODEL_TEMPLATES}>{(model) => <option value={model} />}</For></datalist>
          <input
            placeholder="显示名称 (如 DeepSeek Chat)"
            value={newDisplayName()}
            onInput={(e) => setNewDisplayName(e.currentTarget.value)}
            required
          />
          <div class="model-bind-fields">
            <label>同时绑定渠道（可选）
              <select value={newChannelId()} onChange={(e) => chooseCreateChannel(e.currentTarget.value)}>
                <option value="">稍后绑定</option>
                <For each={activeChannels()}>{(channel) => <option value={channel.id}>{channel.name}</option>}</For>
              </select>
            </label>
            <Show when={newChannelId()}><label>渠道模型
              <input
                list="create-channel-models"
                placeholder={inventoryLoading() ? '加载模型中…' : '选择已发现模型或直接输入'}
                value={newUpstreamModel()}
                onInput={(e) => setNewUpstreamModel(e.currentTarget.value)}
                required
              />
              <datalist id="create-channel-models"><For each={availableInventory(newChannelId())}>{(model) => <option value={model.provider_model_id}>{model.display_name}</option>}</For></datalist>
              <small>公开 Alias 自动生成；统一模型 ID 仍可自由修改。</small>
            </label></Show>
          </div>
          <Show when={createError()}><div class="form-error">{createError()}</div></Show>
          <div class="inline-form-actions"><button type="submit" disabled={creating()} class="primary-button">
            {creating() ? '创建中...' : '创建'}
          </button></div>
        </form>
      </Show>

      {loading() && <p class="empty-state">Loading...</p>}
      <Show when={!loading() && cards().length === 0}><div class="panel empty-state"><span class="provider-logo">M</span><h3>还没有统一模型</h3><p>创建模型后，再绑定一个或多个渠道实例。</p></div></Show>

      <div class="model-grid">
        <For each={cards()}>
          {(card) => (
            <div class="panel model-card">
              <div class="model-card-head">
                <span class="provider-logo">M</span>
                <div class="resource-main">
                  <strong>{card.display_name}</strong>
                  <span><code>{card.unified_model_id}</code> · {card.instances.length} 个渠道实例</span>
                </div>
                <div class="row-actions">
                  <span class={`badge ${card.status}`}>
                    {card.status === 'active' ? '运行中' : '已停用'}
                  </span>
                  <button onClick={() => setExpandedCard(expandedCard() === card.id ? null : card.id)}>
                    {expandedCard() === card.id ? '收起' : '实例'}
                  </button>
                  <button onClick={() => deleteCard(card.id)} class="danger-link">删除</button>
                </div>
              </div>

              {/* Instances */}
              <Show when={expandedCard() === card.id}>
                <div class="model-instances">
                  <div class="instances-title">
                    <p>渠道实例 <span>{card.instances.length}</span></p>
                    <button onClick={() => openAdd(card)} class="secondary-button">
                      + 添加实例
                    </button>
                  </div>

                  {/* Add instance form */}
                  <Show when={addForCard() === card.id}>
                    <form onSubmit={submitInstance} class="instance-form form-stack">
                      <strong>绑定渠道实例</strong>
                      <select value={instChannelId()} onChange={(e) => chooseInstanceChannel(e.currentTarget.value)}>
                        <Show when={activeChannels().length === 0}>
                          <option value="">（无可用渠道，请先在 Channels 页添加）</option>
                        </Show>
                        <For each={activeChannels()}>
                          {(ch) => <option value={ch.id}>{ch.name} — {ch.base_url}</option>}
                        </For>
                      </select>
                      <input list="instance-channel-models" placeholder="选择已发现模型或直接输入上游模型 ID" value={instUpstreamModel()} onInput={(e) => { const value = e.currentTarget.value; setInstUpstreamModel(value); setInstAlias(suggestedAlias(instChannelId(), value)); }} required />
                      <datalist id="instance-channel-models"><For each={availableInventory(instChannelId())}>{(model) => <option value={model.provider_model_id}>{model.display_name}</option>}</For></datalist>
                      <input placeholder="公开别名 (如 ds-deepseek-chat)" value={instAlias()} onInput={(e) => setInstAlias(e.currentTarget.value)} required />
                      <label class="checkbox-label">
                        <input type="checkbox" checked={instStreamUsage()} onChange={(e) => setInstStreamUsage(e.currentTarget.checked)} class="accent-[var(--color-primary)]" />
                        支持流式 usage
                      </label>
                      <Show when={instError()}><div class="form-error">{instError()}</div></Show>
                      <button type="submit" disabled={instBusy()} class="primary-button">
                        {instBusy() ? '添加中...' : '添加实例'}
                      </button>
                    </form>
                  </Show>

                  <div class="instance-list">
                    <For each={[...card.instances].sort((a, b) => a.sort_order - b.sort_order)}>
                      {(inst, idx) => (
                        <div class="instance-row">
                          <div class="resource-main">
                            <strong><code>{inst.public_model_alias}</code></strong>
                            <span>{channelName(inst.channel_id)} → <code>{inst.channel_model_id}</code>{inst.supports_stream_usage ? ' · stream usage' : ''}</span>
                          </div>
                          <div class="instance-order">
                            <span class={`badge ${inst.status}`}>
                              #{idx() + 1}
                            </span>
                            <button onClick={() => move(card, inst, -1)} disabled={idx() === 0}>↑</button>
                            <button onClick={() => move(card, inst, 1)} disabled={idx() === card.instances.length - 1}>↓</button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
