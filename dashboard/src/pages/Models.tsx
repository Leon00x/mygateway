import { createSignal, onMount, For, Show } from 'solid-js';
import { COMMON_MODEL_TEMPLATES } from '../presets';
import { ProviderLogo } from '../components/ProviderLogo';

const dollarsToMicros = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1_000_000) : null;
};

const microsToDollars = (micros: number | null): string =>
  micros === null ? '' : String(micros / 1_000_000);

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
  input_price_micros_per_million: number | null;
  output_price_micros_per_million: number | null;
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
  const [addForCard, setAddForCard] = createSignal<string | null>(null);
  const [instChannelId, setInstChannelId] = createSignal('');
  const [instUpstreamModel, setInstUpstreamModel] = createSignal('');
  const [instAlias, setInstAlias] = createSignal('');
  const [instStreamUsage, setInstStreamUsage] = createSignal(true);
  const [instInputPrice, setInstInputPrice] = createSignal('');
  const [instOutputPrice, setInstOutputPrice] = createSignal('');
  const [instError, setInstError] = createSignal('');
  const [instBusy, setInstBusy] = createSignal(false);

  // Edit instance pricing
  const [editInst, setEditInst] = createSignal<{ card: ModelCard; instance: Instance } | null>(null);
  const [editInstInput, setEditInstInput] = createSignal('');
  const [editInstOutput, setEditInstOutput] = createSignal('');
  const [editInstBusy, setEditInstBusy] = createSignal(false);

  // Edit card
  const [editCard, setEditCard] = createSignal<ModelCard | null>(null);
  const [editName, setEditName] = createSignal('');
  const [editStatus, setEditStatus] = createSignal<'active' | 'disabled'>('active');
  const [editError, setEditError] = createSignal('');
  const [editBusy, setEditBusy] = createSignal(false);

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

  const channelOf = (id: string) => channels().find((c) => c.id === id);
  const channelName = (id: string) => channelOf(id)?.name ?? id.slice(0, 8);

  const suggestedAlias = (channelId: string, modelId: string) => {
    const channel = channelOf(channelId);
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
    setInstInputPrice('');
    setInstOutputPrice('');
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
          input_price_micros_per_million: dollarsToMicros(instInputPrice()),
          output_price_micros_per_million: dollarsToMicros(instOutputPrice()),
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

  // --- Edit card (rename / enable-disable) ---
  const openEdit = (card: ModelCard) => {
    setEditCard(card);
    setEditName(card.display_name);
    setEditStatus(card.status === 'active' ? 'active' : 'disabled');
    setEditError('');
  };

  const saveEdit = async (e: Event) => {
    e.preventDefault();
    const card = editCard();
    if (!card || !editName().trim()) return;
    setEditBusy(true);
    setEditError('');
    try {
      const resp = await fetch(`/admin/api/models/${card.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: editName().trim(), status: editStatus() }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error?.message ?? '保存失败');
      }
      setEditCard(null);
      await fetchAll();
    } catch (err) { setEditError((err as Error).message); }
    setEditBusy(false);
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
    if (!confirm('删除该模型及其全部渠道实例？历史用量会保留。')) return;
    const resp = await fetch(`/admin/api/models/${id}`, { method: 'DELETE' });
    if (!resp.ok) alert('删除失败');
    fetchAll();
  };

  const sortedInstances = (card: ModelCard) =>
    [...card.instances].sort((a, b) => a.sort_order - b.sort_order);

  const openEditPricing = (card: ModelCard, instance: Instance) => {
    setEditInst({ card, instance });
    setEditInstInput(microsToDollars(instance.input_price_micros_per_million));
    setEditInstOutput(microsToDollars(instance.output_price_micros_per_million));
  };

  const savePricing = async (e: Event) => {
    e.preventDefault();
    const target = editInst();
    if (!target) return;
    setEditInstBusy(true);
    try {
      const resp = await fetch(`/admin/api/models/${target.card.id}/instances/${target.instance.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_price_micros_per_million: dollarsToMicros(editInstInput()),
          output_price_micros_per_million: dollarsToMicros(editInstOutput()),
        }),
      });
      if (resp.ok) { setEditInst(null); await fetchAll(); }
    } finally { setEditInstBusy(false); }
  };

  const priceLabel = (inst: Instance): string => {
    const input = inst.input_price_micros_per_million;
    const output = inst.output_price_micros_per_million;
    if (input === null && output === null) return '未定价';
    return `$${((input ?? 0) / 1_000_000).toFixed(2)} / $${((output ?? 0) / 1_000_000).toFixed(2)} M`;
  };

  return (
    <div class="resource-page model-page">
      <div class="page-heading">
        <div><h2>Unified Models</h2><p>一个模型 ID 可以绑定多个渠道，并按顺序自动回退。</p></div>
        <button onClick={() => setShowCreate(!showCreate())} class="primary-button">+ 创建模型</button>
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

      <div class="channel-card-grid model-card-grid">
        <For each={cards()}>
          {(card) => (
            <article class="panel channel-card model-card">
              <header class="channel-card-head">
                <span class="provider-logo">M</span>
                <div><strong>{card.display_name}</strong><span><code>{card.unified_model_id}</code></span></div>
                <span class={`badge ${card.status}`}>{card.status === 'active' ? '运行中' : '已停用'}</span>
              </header>

              <div class="channel-card-metrics">
                <div><span>渠道实例</span><strong>{card.instances.length} 个</strong></div>
                <div><span>可用渠道</span><strong class="muted-value">{card.instances.filter((i) => i.status === 'active').length} 个</strong></div>
              </div>

              <div class="channel-card-section model-instance-section">
                <div class="channel-card-label"><span>回退顺序</span><strong>{sortedInstances(card).length} 个实例</strong></div>
                <div class="model-instance-list">
                  <Show when={sortedInstances(card).length === 0} fallback={<For each={sortedInstances(card)}>{(inst, idx) => (
                    <div class="model-instance-row">
                      <ProviderLogo presetId={channelOf(inst.channel_id)?.preset_id} name={channelName(inst.channel_id)} />
                      <div class="model-instance-copy">
                        <strong>{channelName(inst.channel_id)}</strong>
                        <code><span class="instance-alias">{inst.public_model_alias}</span> → {inst.channel_model_id}</code>
                        <span class="instance-price">{priceLabel(inst)}</span>
                      </div>
                      <div class="instance-order">
                        <span class={`badge ${inst.status}`}>#{idx() + 1}</span>
                        <button title="定价" onClick={() => openEditPricing(card, inst)}>$</button>
                        <button title="上移" disabled={idx() === 0} onClick={() => move(card, inst, -1)}>↑</button>
                        <button title="下移" disabled={idx() === sortedInstances(card).length - 1} onClick={() => move(card, inst, 1)}>↓</button>
                      </div>
                    </div>
                  )}</For>}>
                    <span class="empty-preview">尚未绑定渠道，点下方"添加实例"。</span>
                  </Show>
                </div>
              </div>

              <footer class="channel-card-actions model-card-actions">
                <button class="primary-button" onClick={() => openAdd(card)}>+ 添加实例</button>
                <button class="secondary-button" onClick={() => openEdit(card)}>编辑</button>
                <button class="secondary-button danger-link" onClick={() => deleteCard(card.id)}>删除</button>
              </footer>
            </article>
          )}
        </For>
      </div>

      {/* Add instance modal */}
      <Show when={addForCard()}>{(cardId) => {
        const card = () => cards().find((c) => c.id === cardId());
        return (
          <div class="modal-backdrop" onClick={() => setAddForCard(null)}>
            <form class="modal-card form-stack" onSubmit={submitInstance} onClick={(e) => e.stopPropagation()}>
              <div class="modal-title"><div><span class="eyebrow">Instance</span><h3>绑定渠道实例</h3><p>{card()?.display_name} · {card()?.unified_model_id}</p></div><button type="button" onClick={() => setAddForCard(null)}>×</button></div>
              <Show when={activeChannels().length === 0}>
                <div class="form-error">暂无可用渠道，请先在 Channels 页添加并启用渠道。</div>
              </Show>
              <label>渠道
                <select value={instChannelId()} onChange={(e) => chooseInstanceChannel(e.currentTarget.value)}>
                  <Show when={activeChannels().length === 0}><option value="">（无可用渠道）</option></Show>
                  <For each={activeChannels()}>
                    {(ch) => <option value={ch.id}>{ch.name} — {ch.base_url}</option>}
                  </For>
                </select>
              </label>
              <label>上游模型 ID
                <input list="instance-channel-models" placeholder="选择已发现模型或直接输入上游模型 ID" value={instUpstreamModel()} onInput={(e) => { const value = e.currentTarget.value; setInstUpstreamModel(value); setInstAlias(suggestedAlias(instChannelId(), value)); }} required />
                <datalist id="instance-channel-models"><For each={availableInventory(instChannelId())}>{(model) => <option value={model.provider_model_id}>{model.display_name}</option>}</For></datalist>
              </label>
              <label>公开别名（客户端可直接用此 ID 调用）
                <input placeholder="如 ds-deepseek-chat" value={instAlias()} onInput={(e) => setInstAlias(e.currentTarget.value)} required />
              </label>
              <label class="checkbox-label">
                <input type="checkbox" checked={instStreamUsage()} onChange={(e) => setInstStreamUsage(e.currentTarget.checked)} />
                支持流式 usage
              </label>
              <div class="model-bind-fields">
                <label>输入价格 ($/M token，用于费用统计)
                  <input type="number" min="0" step="0.01" placeholder="留空不统计" value={instInputPrice()} onInput={(e) => setInstInputPrice(e.currentTarget.value)} />
                </label>
                <label>输出价格 ($/M token)
                  <input type="number" min="0" step="0.01" placeholder="留空不统计" value={instOutputPrice()} onInput={(e) => setInstOutputPrice(e.currentTarget.value)} />
                </label>
              </div>
              <Show when={instError()}><div class="form-error">{instError()}</div></Show>
              <div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setAddForCard(null)}>取消</button><button type="submit" disabled={instBusy()} class="primary-button">{instBusy() ? '添加中...' : '添加实例'}</button></div>
            </form>
          </div>
        );
      }}</Show>

      {/* Edit instance pricing modal */}
      <Show when={editInst()}>{(target) => (
        <div class="modal-backdrop" onClick={() => setEditInst(null)}>
          <form class="modal-card form-stack" onSubmit={savePricing} onClick={(e) => e.stopPropagation()}>
            <div class="modal-title"><div><span class="eyebrow">Pricing</span><h3>实例定价</h3><p>{target().instance.public_model_alias} · {target().card.unified_model_id}</p></div><button type="button" onClick={() => setEditInst(null)}>×</button></div>
            <div class="model-bind-fields">
              <label>输入价格 ($/M token)
                <input type="number" min="0" step="0.01" placeholder="留空不统计" value={editInstInput()} onInput={(e) => setEditInstInput(e.currentTarget.value)} />
              </label>
              <label>输出价格 ($/M token)
                <input type="number" min="0" step="0.01" placeholder="留空不统计" value={editInstOutput()} onInput={(e) => setEditInstOutput(e.currentTarget.value)} />
              </label>
            </div>
            <small class="pricing-note">费用 = (输入 tokens × 输入价 + 输出 tokens × 输出价) / 1,000,000，按美元统计。</small>
            <div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setEditInst(null)}>取消</button><button type="submit" disabled={editInstBusy()} class="primary-button">保存定价</button></div>
          </form>
        </div>
      )}</Show>

      {/* Edit modal */}
      <Show when={editCard()}>{(card) => (
        <div class="modal-backdrop" onClick={() => setEditCard(null)}>
          <form class="modal-card form-stack" onSubmit={saveEdit} onClick={(e) => e.stopPropagation()}>
            <div class="modal-title"><div><span class="eyebrow">Model</span><h3>编辑模型</h3><p>{card().unified_model_id}</p></div><button type="button" onClick={() => setEditCard(null)}>×</button></div>
            <label>显示名称<input value={editName()} onInput={(e) => setEditName(e.currentTarget.value)} required /></label>
            <label>状态
              <select value={editStatus()} onChange={(e) => setEditStatus(e.currentTarget.value as 'active' | 'disabled')}>
                <option value="active">运行中</option>
                <option value="disabled">已停用</option>
              </select>
            </label>
            <Show when={editError()}><div class="form-error">{editError()}</div></Show>
            <div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setEditCard(null)}>取消</button><button type="submit" disabled={editBusy()} class="primary-button">{editBusy() ? '保存中…' : '保存'}</button></div>
          </form>
        </div>
      )}</Show>
    </div>
  );
}
