import { createSignal, onMount, For, Show } from 'solid-js';
import { COMMON_MODEL_TEMPLATES } from '../presets';
import { ProviderLogo } from '../components/ProviderLogo';
import { t } from '../i18n';

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
  cache_input_price_micros_per_million: number | null;
  currency: string | null;
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
  const [instCachePrice, setInstCachePrice] = createSignal('');
  const [instCurrency, setInstCurrency] = createSignal<'USD' | 'CNY'>('USD');
  const [instError, setInstError] = createSignal('');
  const [instBusy, setInstBusy] = createSignal(false);

  // Edit instance pricing
  const [editInst, setEditInst] = createSignal<{ card: ModelCard; instance: Instance } | null>(null);
  const [editInstInput, setEditInstInput] = createSignal('');
  const [editInstOutput, setEditInstOutput] = createSignal('');
  const [editInstCache, setEditInstCache] = createSignal('');
  const [editInstCurrency, setEditInstCurrency] = createSignal<'USD' | 'CNY'>('USD');
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
    setInstCachePrice('');
    setInstCurrency('USD');
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
          cache_input_price_micros_per_million: dollarsToMicros(instCachePrice()),
          currency: instCurrency(),
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
        throw new Error(data.error?.message ?? t('keys.saveFailed'));
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
    if (!confirm(t('models.deleteConfirm'))) return;
    const resp = await fetch(`/admin/api/models/${id}`, { method: 'DELETE' });
    if (!resp.ok) alert(t('models.deleteFailed'));
    fetchAll();
  };

  const sortedInstances = (card: ModelCard) =>
    [...card.instances].sort((a, b) => a.sort_order - b.sort_order);

  const openEditPricing = (card: ModelCard, instance: Instance) => {
    setEditInst({ card, instance });
    setEditInstInput(microsToDollars(instance.input_price_micros_per_million));
    setEditInstOutput(microsToDollars(instance.output_price_micros_per_million));
    setEditInstCache(microsToDollars(instance.cache_input_price_micros_per_million));
    setEditInstCurrency(instance.currency === 'CNY' ? 'CNY' : 'USD');
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
          cache_input_price_micros_per_million: dollarsToMicros(editInstCache()),
          currency: editInstCurrency(),
        }),
      });
      if (resp.ok) { setEditInst(null); await fetchAll(); }
    } finally { setEditInstBusy(false); }
  };

  const priceLabel = (inst: Instance): string => {
    const input = inst.input_price_micros_per_million;
    const output = inst.output_price_micros_per_million;
    if (input === null && output === null) return t('models.unpriced');
    const sym = inst.currency === 'CNY' ? '¥' : '$';
    const parts = [`${sym}${((input ?? 0) / 1_000_000).toFixed(2)}/${sym}${((output ?? 0) / 1_000_000).toFixed(2)} M`];
    if (inst.cache_input_price_micros_per_million != null && inst.cache_input_price_micros_per_million > 0) {
      parts.push(`${sym}${(inst.cache_input_price_micros_per_million / 1_000_000).toFixed(2)} C`);
    }
    return parts.join(' · ');
  };

  return (
    <div class="resource-page model-page">
      <div class="page-heading">
        <div><h2>{t('models.title')}</h2><p>{t('models.subtitle')}</p></div>
        <button onClick={() => setShowCreate(!showCreate())} class="primary-button">{t('models.create')}</button>
      </div>

      {/* Create card form */}
      <Show when={showCreate()}>
        <form onSubmit={submitCreate} class="panel inline-form form-stack">
          <div class="inline-form-title"><div><h3>{t('models.createTitle')}</h3><p>{t('models.createSub')}</p></div><button type="button" onClick={() => setShowCreate(false)}>×</button></div>
          <input
            placeholder={t('models.unifiedId')}
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
            placeholder={t('models.displayName')}
            value={newDisplayName()}
            onInput={(e) => setNewDisplayName(e.currentTarget.value)}
            required
          />
          <div class="model-bind-fields">
            <label>{t('models.bindChannel')}
              <select value={newChannelId()} onChange={(e) => chooseCreateChannel(e.currentTarget.value)}>
                <option value="">{t('models.bindLater')}</option>
                <For each={activeChannels()}>{(channel) => <option value={channel.id}>{channel.name}</option>}</For>
              </select>
            </label>
            <Show when={newChannelId()}><label>{t('models.channelModel')}
              <input
                list="create-channel-models"
                placeholder={inventoryLoading() ? t('models.loadingModels') : t('models.selectOrEnter')}
                value={newUpstreamModel()}
                onInput={(e) => setNewUpstreamModel(e.currentTarget.value)}
                required
              />
              <datalist id="create-channel-models"><For each={availableInventory(newChannelId())}>{(model) => <option value={model.provider_model_id}>{model.display_name}</option>}</For></datalist>
              <small>{t('models.aliasAuto')}</small>
            </label></Show>
          </div>
          <Show when={createError()}><div class="form-error">{createError()}</div></Show>
          <div class="inline-form-actions"><button type="submit" disabled={creating()} class="primary-button">
            {creating() ? t('common.loading') : t('models.createButton')}
          </button></div>
        </form>
      </Show>

      {loading() && <p class="empty-state">Loading...</p>}
      <Show when={!loading() && cards().length === 0}><div class="panel empty-state"><span class="provider-logo">M</span><h3>{t('models.emptyTitle')}</h3><p>{t('models.emptyBody')}</p></div></Show>

      <div class="channel-card-grid model-card-grid">
        <For each={cards()}>
          {(card) => (
            <article class="panel channel-card model-card">
              <header class="channel-card-head">
                <span class="provider-logo">M</span>
                <div><strong>{card.display_name}</strong><span><code>{card.unified_model_id}</code></span></div>
                <span class={`badge ${card.status}`}>{card.status === 'active' ? t('common.active') : t('common.disabled')}</span>
              </header>

              <div class="channel-card-metrics">
                <div><span>{t('models.instances')}</span><strong>{card.instances.length}</strong></div>
                <div><span>{t('channels.available')}</span><strong class="muted-value">{card.instances.filter((i) => i.status === 'active').length}</strong></div>
              </div>

              <div class="channel-card-section model-instance-section">
                <div class="channel-card-label"><span>{t('models.fallbackOrder')}</span><strong>{sortedInstances(card).length}</strong></div>
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
                        <button title={t('models.pricing')} onClick={() => openEditPricing(card, inst)}>$</button>
                        <button title={t('models.moveUp')} disabled={idx() === 0} onClick={() => move(card, inst, -1)}>↑</button>
                        <button title={t('models.moveDown')} disabled={idx() === sortedInstances(card).length - 1} onClick={() => move(card, inst, 1)}>↓</button>
                      </div>
                    </div>
                  )}</For>}>
                    <span class="empty-preview">{t('models.notBound')}</span>
                  </Show>
                </div>
              </div>

              <footer class="channel-card-actions model-card-actions">
                <button class="primary-button" onClick={() => openAdd(card)}>{t('models.addInstance')}</button>
                <button class="secondary-button" onClick={() => openEdit(card)}>{t('models.edit')}</button>
                <button class="secondary-button danger-link" onClick={() => deleteCard(card.id)}>{t('common.delete')}</button>
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
              <div class="modal-title"><div><span class="eyebrow">{t('models.eyebrowInstance')}</span><h3>{t('models.bindInstanceTitle')}</h3><p>{card()?.display_name} · {card()?.unified_model_id}</p></div><button type="button" onClick={() => setAddForCard(null)}>×</button></div>
              <Show when={activeChannels().length === 0}>
                <div class="form-error">{t('models.noChannels')}</div>
              </Show>
              <label>{t('common.channel')}
                <select value={instChannelId()} onChange={(e) => chooseInstanceChannel(e.currentTarget.value)}>
                  <Show when={activeChannels().length === 0}><option value="">（{t('channels.available')} —）</option></Show>
                  <For each={activeChannels()}>
                    {(ch) => <option value={ch.id}>{ch.name} — {ch.base_url}</option>}
                  </For>
                </select>
              </label>
              <label>{t('models.upstreamModelId')}
                <input list="instance-channel-models" placeholder={t('models.selectOrEnter')} value={instUpstreamModel()} onInput={(e) => { const value = e.currentTarget.value; setInstUpstreamModel(value); setInstAlias(suggestedAlias(instChannelId(), value)); }} required />
                <datalist id="instance-channel-models"><For each={availableInventory(instChannelId())}>{(model) => <option value={model.provider_model_id}>{model.display_name}</option>}</For></datalist>
              </label>
              <label>{t('models.publicAlias')}
                <input placeholder="ds-deepseek-chat" value={instAlias()} onInput={(e) => setInstAlias(e.currentTarget.value)} required />
              </label>
              <label class="checkbox-label">
                <input type="checkbox" checked={instStreamUsage()} onChange={(e) => setInstStreamUsage(e.currentTarget.checked)} />
                {t('models.streamUsage')}
              </label>
              <div class="model-bind-fields">
                <label>{t('models.inputPrice')}
                  <input type="number" min="0" step="0.01" placeholder="—" value={instInputPrice()} onInput={(e) => setInstInputPrice(e.currentTarget.value)} />
                </label>
                <label>{t('models.outputPrice')}
                  <input type="number" min="0" step="0.01" placeholder="—" value={instOutputPrice()} onInput={(e) => setInstOutputPrice(e.currentTarget.value)} />
                </label>
                <label>{t('models.cachePrice')}
                  <input type="number" min="0" step="0.01" placeholder="—" value={instCachePrice()} onInput={(e) => setInstCachePrice(e.currentTarget.value)} />
                </label>
                <label>{t('models.currency')}
                  <select value={instCurrency()} onChange={(e) => setInstCurrency(e.currentTarget.value as 'USD' | 'CNY')}>
                    <option value="USD">USD</option>
                    <option value="CNY">CNY</option>
                  </select>
                </label>
              </div>
              <Show when={instError()}><div class="form-error">{instError()}</div></Show>
              <div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setAddForCard(null)}>{t('common.cancel')}</button><button type="submit" disabled={instBusy()} class="primary-button">{instBusy() ? t('common.loading') : t('models.addInstance')}</button></div>
            </form>
          </div>
        );
      }}</Show>

      {/* Edit instance pricing modal */}
      <Show when={editInst()}>{(target) => (
        <div class="modal-backdrop" onClick={() => setEditInst(null)}>
          <form class="modal-card form-stack" onSubmit={savePricing} onClick={(e) => e.stopPropagation()}>
            <div class="modal-title"><div><span class="eyebrow">{t('models.eyebrowPricing')}</span><h3>{t('models.pricing')}</h3><p>{target().instance.public_model_alias} · {target().card.unified_model_id}</p></div><button type="button" onClick={() => setEditInst(null)}>×</button></div>
            <div class="model-bind-fields">
              <label>{t('models.inputPrice')}
                <input type="number" min="0" step="0.01" placeholder="—" value={editInstInput()} onInput={(e) => setEditInstInput(e.currentTarget.value)} />
              </label>
              <label>{t('models.outputPrice')}
                <input type="number" min="0" step="0.01" placeholder="—" value={editInstOutput()} onInput={(e) => setEditInstOutput(e.currentTarget.value)} />
              </label>
              <label>{t('models.cachePrice')}
                <input type="number" min="0" step="0.01" placeholder="—" value={editInstCache()} onInput={(e) => setEditInstCache(e.currentTarget.value)} />
              </label>
              <label>{t('models.currency')}
                <select value={editInstCurrency()} onChange={(e) => setEditInstCurrency(e.currentTarget.value as 'USD' | 'CNY')}>
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                </select>
              </label>
            </div>
            <small class="pricing-note">{t('models.pricingNote')}</small>
            <div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setEditInst(null)}>{t('common.cancel')}</button><button type="submit" disabled={editInstBusy()} class="primary-button">{t('models.savePricing')}</button></div>
          </form>
        </div>
      )}</Show>

      {/* Edit modal */}
      <Show when={editCard()}>{(card) => (
        <div class="modal-backdrop" onClick={() => setEditCard(null)}>
          <form class="modal-card form-stack" onSubmit={saveEdit} onClick={(e) => e.stopPropagation()}>
            <div class="modal-title"><div><span class="eyebrow">{t('models.eyebrowModel')}</span><h3>{t('models.editModel')}</h3><p>{card().unified_model_id}</p></div><button type="button" onClick={() => setEditCard(null)}>×</button></div>
            <label>{t('models.displayName')}<input value={editName()} onInput={(e) => setEditName(e.currentTarget.value)} required /></label>
            <label>{t('common.status')}
              <select value={editStatus()} onChange={(e) => setEditStatus(e.currentTarget.value as 'active' | 'disabled')}>
                <option value="active">{t('common.active')}</option>
                <option value="disabled">{t('common.disabled')}</option>
              </select>
            </label>
            <Show when={editError()}><div class="form-error">{editError()}</div></Show>
            <div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setEditCard(null)}>{t('common.cancel')}</button><button type="submit" disabled={editBusy()} class="primary-button">{editBusy() ? t('common.saving') : t('common.save')}</button></div>
          </form>
        </div>
      )}</Show>
    </div>
  );
}
