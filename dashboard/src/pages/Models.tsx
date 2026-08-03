import { createSignal, onMount, For, Show } from 'solid-js';

interface Channel {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  status: string;
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

  const channelName = (id: string) => channels().find((c) => c.id === id)?.name ?? id.slice(0, 8);

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
        body: JSON.stringify({ unified_model_id: newModelId(), display_name: newDisplayName() }),
      });
      if (resp.ok) {
        setShowCreate(false);
        setNewModelId('');
        setNewDisplayName('');
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
    <div>
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold">Models</h2>
        <button
          onClick={() => setShowCreate(!showCreate())}
          class="px-3 py-1.5 bg-[var(--color-primary)] text-white rounded text-sm font-medium hover:opacity-90"
        >
          + 创建模型
        </button>
      </div>

      {/* Create card form */}
      <Show when={showCreate()}>
        <form onSubmit={submitCreate} class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 mb-4 space-y-3">
          <p class="text-sm font-medium">创建统一模型</p>
          <input
            placeholder="统一模型 ID (如 deepseek-chat)"
            value={newModelId()}
            onInput={(e) => setNewModelId(e.currentTarget.value)}
            class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm"
            required
          />
          <input
            placeholder="显示名称 (如 DeepSeek Chat)"
            value={newDisplayName()}
            onInput={(e) => setNewDisplayName(e.currentTarget.value)}
            class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm"
            required
          />
          <Show when={createError()}><p class="text-xs text-red-400">{createError()}</p></Show>
          <button type="submit" disabled={creating()} class="px-4 py-2 bg-[var(--color-primary)] text-white rounded text-sm disabled:opacity-50">
            {creating() ? '创建中...' : '创建'}
          </button>
        </form>
      </Show>

      {loading() && <p class="text-[var(--color-muted)]">Loading...</p>}

      <div class="space-y-3">
        <For each={cards()}>
          {(card) => (
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="font-medium">{card.display_name}</p>
                  <p class="text-xs text-[var(--color-muted)] font-mono">{card.unified_model_id}</p>
                </div>
                <div class="flex items-center gap-3">
                  <span class={`text-xs px-2 py-0.5 rounded ${card.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                    {card.status}
                  </span>
                  <button onClick={() => setExpandedCard(expandedCard() === card.id ? null : card.id)} class="text-xs text-[var(--color-primary)] hover:underline">
                    {expandedCard() === card.id ? '收起' : '实例'}
                  </button>
                  <button onClick={() => deleteCard(card.id)} class="text-xs text-red-400 hover:text-red-300">Delete</button>
                </div>
              </div>

              {/* Instances */}
              <Show when={expandedCard() === card.id}>
                <div class="mt-4 pt-4 border-t border-[var(--color-border)]">
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-xs text-[var(--color-muted)] uppercase tracking-wider">渠道实例 ({card.instances.length})</p>
                    <button onClick={() => openAdd(card)} class="text-xs px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded hover:text-white">
                      + 添加实例
                    </button>
                  </div>

                  {/* Add instance form */}
                  <Show when={addForCard() === card.id}>
                    <form onSubmit={submitInstance} class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-3 mb-3 space-y-2">
                      <p class="text-xs font-medium">绑定渠道实例</p>
                      <select value={instChannelId()} onChange={(e) => setInstChannelId(e.currentTarget.value)} class="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm">
                        <Show when={activeChannels().length === 0}>
                          <option value="">（无可用渠道，请先在 Channels 页添加）</option>
                        </Show>
                        <For each={activeChannels()}>
                          {(ch) => <option value={ch.id}>{ch.name} — {ch.base_url}</option>}
                        </For>
                      </select>
                      <input placeholder="上游模型 ID (如 deepseek-chat)" value={instUpstreamModel()} onInput={(e) => setInstUpstreamModel(e.currentTarget.value)} class="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm" required />
                      <input placeholder="公开别名 (如 ds-deepseek-chat)" value={instAlias()} onInput={(e) => setInstAlias(e.currentTarget.value)} class="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm" required />
                      <label class="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                        <input type="checkbox" checked={instStreamUsage()} onChange={(e) => setInstStreamUsage(e.currentTarget.checked)} class="accent-[var(--color-primary)]" />
                        支持流式 usage
                      </label>
                      <Show when={instError()}><p class="text-xs text-red-400">{instError()}</p></Show>
                      <button type="submit" disabled={instBusy()} class="px-3 py-1.5 bg-[var(--color-primary)] text-white rounded text-xs disabled:opacity-50">
                        {instBusy() ? '添加中...' : '添加实例'}
                      </button>
                    </form>
                  </Show>

                  <div class="space-y-2">
                    <For each={[...card.instances].sort((a, b) => a.sort_order - b.sort_order)}>
                      {(inst, idx) => (
                        <div class="flex items-center justify-between bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2">
                          <div>
                            <p class="text-sm font-mono">{inst.public_model_alias}</p>
                            <p class="text-xs text-[var(--color-muted)] font-mono">{channelName(inst.channel_id)} → {inst.channel_model_id}{inst.supports_stream_usage ? ' · stream-usage' : ''}</p>
                          </div>
                          <div class="flex items-center gap-2">
                            <span class={`text-[10px] px-2 py-0.5 rounded ${inst.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                              #{idx() + 1}
                            </span>
                            <button onClick={() => move(card, inst, -1)} class="text-xs text-[var(--color-muted)] hover:text-white" disabled={idx() === 0}>↑</button>
                            <button onClick={() => move(card, inst, 1)} class="text-xs text-[var(--color-muted)] hover:text-white" disabled={idx() === card.instances.length - 1}>↓</button>
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
