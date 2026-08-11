import { createSignal, onMount, For, Show } from 'solid-js';
import { t } from '../i18n';
import Icon from '../components/Icon';
import { useAppDialog } from '../components/AppDialog';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  status: string;
  created_at: number;
  rpm_limit: number | null;
  daily_request_limit: number | null;
  daily_token_limit: number | null;
  expires_at: number | null;
  model_allowlist: string[];
  is_temporary: boolean;
}

interface KeyForm {
  name: string;
  rpm: string;
  dailyRequests: string;
  dailyTokens: string;
  expiresAt: string;
  allowlist: string;
}

const emptyForm = (): KeyForm => ({
  name: '', rpm: '', dailyRequests: '', dailyTokens: '', expiresAt: '', allowlist: '',
});

const toDateTimeLocal = (timestampSeconds: number): string => {
  const date = new Date(timestampSeconds * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const fromDateTimeLocal = (value: string): number | null => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
};

const minExpiry = () => toDateTimeLocal(Math.floor(Date.now() / 1000) + 60);

const fromKey = (key: ApiKey): KeyForm => ({
  name: key.name,
  rpm: key.rpm_limit ? String(key.rpm_limit) : '',
  dailyRequests: key.daily_request_limit ? String(key.daily_request_limit) : '',
  dailyTokens: key.daily_token_limit ? String(key.daily_token_limit) : '',
  expiresAt: key.expires_at ? toDateTimeLocal(key.expires_at) : '',
  allowlist: key.model_allowlist.join(', '),
});

const intOrNull = (value: string) => (value.trim() === '' ? null : Number(value.trim()));

function limitsSummary(key: ApiKey): string {
  const parts: string[] = [];
  if (key.is_temporary) parts.push(t('keys.temporaryOneHour'));
  if (key.rpm_limit) parts.push(`≤${key.rpm_limit} ${t('keys.perMinute')}`);
  if (key.daily_request_limit) parts.push(`≤${key.daily_request_limit} ${t('keys.perDay')}`);
  if (key.daily_token_limit) parts.push(`≤${(key.daily_token_limit / 1_000_000).toLocaleString()}M ${t('keys.tokensPerDay')}`);
  if (key.model_allowlist.length) parts.push(`${key.model_allowlist.length} ${t('keys.models')}`);
  if (key.expires_at) parts.push(`${t('keys.expiresLabel')} ${new Date(key.expires_at * 1000).toLocaleString()}`);
  return parts.length ? parts.join(' · ') : t('keys.unlimited');
}

export default function ApiKeys() {
  const dialog = useAppDialog();
  const [keys, setKeys] = createSignal<ApiKey[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [revealedKey, setRevealedKey] = createSignal('');
  const [showLimits, setShowLimits] = createSignal(false);
  const [createExpiry, setCreateExpiry] = createSignal('30');
  const [createForm, setCreateForm] = createSignal<KeyForm>(emptyForm());
  const [createError, setCreateError] = createSignal('');
  const [editKey, setEditKey] = createSignal<ApiKey | null>(null);
  const [editForm, setEditForm] = createSignal<KeyForm>(emptyForm());
  const [editError, setEditError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const isExpired = (key: ApiKey) => Boolean(key.expires_at && key.expires_at * 1000 <= Date.now());
  const isUsable = (key: ApiKey) => key.status === 'active' && !isExpired(key);

  const fetchKeys = async () => {
    try { const response = await fetch('/admin/api/keys'); if (response.ok) setKeys(await response.json()); }
    finally { setLoading(false); }
  };
  onMount(fetchKeys);

  const createKey = async (event: Event) => {
    event.preventDefault();
    setBusy(true); setCreateError('');
    const form = createForm();
    const expiresAt = createExpiry() === 'permanent'
      ? null
      : Math.floor(Date.now() / 1000) + Number(createExpiry()) * 86_400;
    const body = {
      name: form.name.trim(),
      rpm_limit: intOrNull(form.rpm),
      daily_request_limit: intOrNull(form.dailyRequests),
      daily_token_limit: intOrNull(form.dailyTokens),
      expires_at: expiresAt,
      model_allowlist: form.allowlist.split(',').map((s) => s.trim()).filter(Boolean),
    };
    const response = await fetch('/admin/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const data = await response.json();
      setRevealedKey(data.key);
      setCreateForm(emptyForm()); setCreateExpiry('30'); setShowLimits(false);
      void fetchKeys();
    } else {
      const data = await response.json();
      setCreateError(data.error?.message ?? t('keys.createFailed'));
    }
    setBusy(false);
  };

  const openEdit = (key: ApiKey) => {
    setEditKey(key); setEditForm(fromKey(key)); setEditError('');
  };

  const saveEdit = async (event: Event) => {
    event.preventDefault();
    const key = editKey(); if (!key) return;
    setBusy(true); setEditError('');
    const form = editForm();
    const expiresAt = fromDateTimeLocal(form.expiresAt);
    if (expiresAt !== null && expiresAt * 1000 <= Date.now()) {
      setEditError(t('keys.expiryFuture'));
      setBusy(false);
      return;
    }
    const body = {
      name: form.name.trim() || key.name,
      rpm_limit: intOrNull(form.rpm),
      daily_request_limit: intOrNull(form.dailyRequests),
      daily_token_limit: intOrNull(form.dailyTokens),
      expires_at: expiresAt,
      model_allowlist: form.allowlist.split(',').map((s) => s.trim()).filter(Boolean),
    };
    const response = await fetch(`/admin/api/keys/${key.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) { setEditKey(null); void fetchKeys(); }
    else { const data = await response.json(); setEditError(data.error?.message ?? t('keys.saveFailed')); }
    setBusy(false);
  };

  const toggleKey = async (key: ApiKey) => {
    await fetch(`/admin/api/keys/${key.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: key.status === 'active' ? 'disabled' : 'active' }),
    });
    void fetchKeys();
  };
  const deleteKey = async (id: string) => {
    if (!await dialog.confirm({ title: t('common.delete'), message: t('keys.deleteConfirm'), danger: true })) return;
    await fetch(`/admin/api/keys/${id}`, { method: 'DELETE' });
    void fetchKeys();
  };

  const limitFields = (
    form: () => KeyForm,
    setForm: (next: KeyForm) => void,
    includeExpiry = true,
  ) => (
    <div class="model-bind-fields key-limit-fields">
      <label>{t('keys.rpm')}
        <input type="number" min="0" placeholder="—" value={form().rpm}
          onInput={(e) => setForm({ ...form(), rpm: e.currentTarget.value })} />
      </label>
      <label>{t('keys.dailyRequests')}
        <input type="number" min="0" placeholder="—" value={form().dailyRequests}
          onInput={(e) => setForm({ ...form(), dailyRequests: e.currentTarget.value })} />
      </label>
      <label>{t('keys.dailyTokens')}
        <input type="number" min="0" placeholder="—" value={form().dailyTokens}
          onInput={(e) => setForm({ ...form(), dailyTokens: e.currentTarget.value })} />
      </label>
      <Show when={includeExpiry}><label>{t('keys.expires')}
          <input type="datetime-local" min={minExpiry()} value={form().expiresAt}
            onInput={(e) => setForm({ ...form(), expiresAt: e.currentTarget.value })} />
          <small>{t('keys.expiresHint')}</small>
        </label></Show>
      <label class="key-allowlist">{t('keys.allowlist')}
        <input placeholder="deepseek-chat, gpt-4o" value={form().allowlist}
          onInput={(e) => setForm({ ...form(), allowlist: e.currentTarget.value })} />
        <small>{t('keys.allowlistHint')}</small>
      </label>
    </div>
  );

  return (
    <div class="resource-page">
      <form onSubmit={createKey} class="panel key-create key-create-form">
        <div class="key-create-heading"><h3>{t('keys.createTitle')}</h3><p>{t('keys.createSub')}</p></div>
        <label class="key-create-field"><span>{t('keys.nameLabel')}</span>
          <input placeholder={t('keys.name')} value={createForm().name}
            onInput={(e) => setCreateForm({ ...createForm(), name: e.currentTarget.value })} required />
        </label>
        <label class="key-expiry-field"><span><Icon name="calendar" size={14} />{t('keys.expires')}</span>
          <select value={createExpiry()} onChange={(e) => setCreateExpiry(e.currentTarget.value)}>
            <option value="1">{t('keys.expiry1d')}</option>
            <option value="7">{t('keys.expiry7d')}</option>
            <option value="30">{t('keys.expiry30d')}</option>
            <option value="90">{t('keys.expiry90d')}</option>
            <option value="permanent">{t('keys.expiryPermanent')}</option>
          </select>
        </label>
        <div class="key-create-actions">
          <button type="button" class="secondary-button" onClick={() => setShowLimits(!showLimits())}>
            <Icon name="sliders" size={15} />{showLimits() ? t('keys.hideLimits') : t('keys.limits')}
          </button>
          <button type="submit" class="primary-button" disabled={busy()}><Icon name="plus" size={16} />{t('keys.create')}</button>
        </div>
        <Show when={showLimits()}>{limitFields(createForm, setCreateForm, false)}</Show>
        <Show when={createError()}><div class="form-error">{createError()}</div></Show>
      </form>

      <Show when={revealedKey()}>
        <div class="secret-reveal panel"><div><span class="eyebrow">{t('keys.revealOnce')}</span><h3>{t('keys.copySave')}</h3><code>{revealedKey()}</code></div><button class="secondary-button" onClick={() => navigator.clipboard.writeText(revealedKey())}><Icon name="copy" size={15} />{t('keys.copy')}</button><button class="secret-close" aria-label={t('common.close')} onClick={() => setRevealedKey('')}><Icon name="close" size={17} /></button></div>
      </Show>

      <section class="panel resource-list">
        <div class="panel-header"><div><h3>{t('keys.list')}</h3><p>{keys().filter(isUsable).length} {t('keys.activeCount')}</p></div></div>
        {loading() && <p class="empty-state">Loading...</p>}
        <Show when={!loading() && keys().length === 0}><div class="empty-state"><span class="provider-logo">K</span><h3>{t('keys.emptyTitle')}</h3><p>{t('keys.emptyBody')}</p></div></Show>
        <div class="resource-rows"><For each={keys()}>{(key) => (
          <div class="resource-row key-row">
            <span class="provider-logo key-logo">K</span>
            <div class="resource-main">
              <strong>{key.name}</strong>
              <span><code>{key.key_prefix}••••••••••••</code> · {t('common.created')} {new Date(key.created_at * 1000).toLocaleDateString()}</span>
              <span class="key-limits-hint">{limitsSummary(key)}</span>
            </div>
            <div class="row-actions">
              <span class={`badge ${isExpired(key) ? 'expired' : key.status}`}>{isExpired(key) ? t('keys.expired') : key.status === 'active' ? t('keys.valid') : t('common.disabled')}</span>
              <Show when={!key.is_temporary}><button onClick={() => openEdit(key)}><Icon name="sliders" size={14} />{isExpired(key) ? t('keys.renew') : t('keys.editLimits')}</button></Show>
              <Show when={!isExpired(key)}><button onClick={() => toggleKey(key)}><Icon name={key.status === 'active' ? 'pause' : 'play'} size={14} />{key.status === 'active' ? t('keys.disable') : t('keys.enable')}</button></Show>
              <button class="danger-link" onClick={() => deleteKey(key.id)}><Icon name="trash" size={14} />{t('common.delete')}</button>
            </div>
          </div>
        )}</For></div>
      </section>

      <Show when={editKey()}>{(key) => (
        <div class="modal-backdrop" onClick={() => setEditKey(null)}>
          <form class="modal-card form-stack" onSubmit={saveEdit} onClick={(e) => e.stopPropagation()}>
            <div class="modal-title"><div><span class="eyebrow">{t('keys.eyebrowKey')}</span><h3>{t('keys.editTitle')}</h3><p>{key().key_prefix}••••</p></div><button type="button" onClick={() => setEditKey(null)}>×</button></div>
            <label>{t('keys.nameLabel')}<input value={editForm().name} onInput={(e) => setEditForm({ ...editForm(), name: e.currentTarget.value })} required /></label>
            {limitFields(editForm, setEditForm)}
            <Show when={editError()}><div class="form-error">{editError()}</div></Show>
            <div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setEditKey(null)}>{t('common.cancel')}</button><button type="submit" disabled={busy()} class="primary-button">{busy() ? t('common.saving') : t('common.save')}</button></div>
          </form>
        </div>
      )}</Show>
    </div>
  );
}
