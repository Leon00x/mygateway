import { createSignal, onMount, For, Show } from 'solid-js';
import { t } from '../i18n';

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
}

interface KeyForm {
  name: string;
  rpm: string;
  dailyRequests: string;
  dailyTokens: string;
  expiresDays: string;
  allowlist: string;
}

const emptyForm = (): KeyForm => ({
  name: '', rpm: '', dailyRequests: '', dailyTokens: '', expiresDays: '', allowlist: '',
});

const fromKey = (key: ApiKey): KeyForm => ({
  name: key.name,
  rpm: key.rpm_limit ? String(key.rpm_limit) : '',
  dailyRequests: key.daily_request_limit ? String(key.daily_request_limit) : '',
  dailyTokens: key.daily_token_limit ? String(key.daily_token_limit) : '',
  expiresDays: key.expires_at
    ? String(Math.max(1, Math.ceil((key.expires_at * 1000 - Date.now()) / 86_400_000)))
    : '',
  allowlist: key.model_allowlist.join(', '),
});

const intOrNull = (value: string) => (value.trim() === '' ? null : Number(value.trim()));

function limitsSummary(key: ApiKey): string {
  const parts: string[] = [];
  if (key.rpm_limit) parts.push(`≤${key.rpm_limit} ${t('keys.perMinute')}`);
  if (key.daily_request_limit) parts.push(`≤${key.daily_request_limit} ${t('keys.perDay')}`);
  if (key.daily_token_limit) parts.push(`≤${(key.daily_token_limit / 1_000_000).toLocaleString()}M ${t('keys.tokensPerDay')}`);
  if (key.model_allowlist.length) parts.push(`${key.model_allowlist.length} ${t('keys.models')}`);
  if (key.expires_at) parts.push(`${new Date(key.expires_at * 1000).toLocaleDateString()} ${t('keys.expiresLabel')}`);
  return parts.length ? parts.join(' · ') : t('keys.unlimited');
}

export default function ApiKeys() {
  const [keys, setKeys] = createSignal<ApiKey[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [revealedKey, setRevealedKey] = createSignal('');
  const [showLimits, setShowLimits] = createSignal(false);
  const [createForm, setCreateForm] = createSignal<KeyForm>(emptyForm());
  const [createError, setCreateError] = createSignal('');
  const [editKey, setEditKey] = createSignal<ApiKey | null>(null);
  const [editForm, setEditForm] = createSignal<KeyForm>(emptyForm());
  const [editError, setEditError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const fetchKeys = async () => {
    try { const response = await fetch('/admin/api/keys'); if (response.ok) setKeys(await response.json()); }
    finally { setLoading(false); }
  };
  onMount(fetchKeys);

  const createKey = async (event: Event) => {
    event.preventDefault();
    setBusy(true); setCreateError('');
    const form = createForm();
    const days = intOrNull(form.expiresDays);
    const body = {
      name: form.name.trim(),
      rpm_limit: intOrNull(form.rpm),
      daily_request_limit: intOrNull(form.dailyRequests),
      daily_token_limit: intOrNull(form.dailyTokens),
      expires_at: days ? Math.floor(Date.now() / 1000) + days * 86_400 : null,
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
      setCreateForm(emptyForm()); setShowLimits(false);
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
    const days = intOrNull(form.expiresDays);
    const body = {
      name: form.name.trim() || key.name,
      rpm_limit: intOrNull(form.rpm),
      daily_request_limit: intOrNull(form.dailyRequests),
      daily_token_limit: intOrNull(form.dailyTokens),
      expires_at: days ? Math.floor(Date.now() / 1000) + days * 86_400 : null,
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
  const regenerate = async (key: ApiKey) => {
    if (!confirm(`${t('keys.regenerateConfirm')}`)) return;
    const response = await fetch(`/admin/api/keys/${key.id}/regenerate`, { method: 'POST' });
    if (response.ok) { setRevealedKey((await response.json()).key); void fetchKeys(); }
  };
  const deleteKey = async (id: string) => {
    if (!confirm(t('keys.deleteConfirm'))) return;
    await fetch(`/admin/api/keys/${id}`, { method: 'DELETE' });
    void fetchKeys();
  };

  const limitFields = (
    form: () => KeyForm,
    setForm: (next: KeyForm) => void,
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
      <label>{t('keys.expires')}
        <input type="number" min="0" placeholder="0" value={form().expiresDays}
          onInput={(e) => setForm({ ...form(), expiresDays: e.currentTarget.value })} />
      </label>
      <label class="key-allowlist">{t('keys.allowlist')}
        <input placeholder="deepseek-chat, gpt-4o" value={form().allowlist}
          onInput={(e) => setForm({ ...form(), allowlist: e.currentTarget.value })} />
        <small>{t('keys.allowlistHint')}</small>
      </label>
    </div>
  );

  return (
    <div class="resource-page">
      <div class="page-heading"><div><h2>Gateway API Keys</h2><p>{t('keys.subtitle')}</p></div></div>

      <Show when={revealedKey()}>
        <div class="secret-reveal panel"><div><span class="eyebrow">{t('keys.revealOnce')}</span><h3>{t('keys.copySave')}</h3><code>{revealedKey()}</code></div><button class="secondary-button" onClick={() => navigator.clipboard.writeText(revealedKey())}>{t('keys.copy')}</button><button class="secret-close" onClick={() => setRevealedKey('')}>×</button></div>
      </Show>

      <form onSubmit={createKey} class="panel key-create key-create-form">
        <div><h3>{t('keys.createTitle')}</h3><p>{t('keys.createSub')}</p></div>
        <input placeholder={t('keys.name')} value={createForm().name}
          onInput={(e) => setCreateForm({ ...createForm(), name: e.currentTarget.value })} required />
        <div class="key-create-actions">
          <button type="button" class="secondary-button" onClick={() => setShowLimits(!showLimits())}>
            {showLimits() ? t('keys.hideLimits') : t('keys.limits')}
          </button>
          <button type="submit" class="primary-button" disabled={busy()}>{t('keys.create')}</button>
        </div>
        <Show when={showLimits()}>{limitFields(createForm, setCreateForm)}</Show>
        <Show when={createError()}><div class="form-error">{createError()}</div></Show>
      </form>

      <section class="panel resource-list">
        <div class="panel-header"><div><h3>{t('keys.list')}</h3><p>{keys().filter((key) => key.status === 'active').length} {t('keys.activeCount')}</p></div></div>
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
              <span class={`badge ${key.status}`}>{key.status === 'active' ? t('keys.valid') : t('common.disabled')}</span>
              <button onClick={() => openEdit(key)}>{t('keys.editLimits')}</button>
              <button onClick={() => toggleKey(key)}>{key.status === 'active' ? t('keys.disable') : t('keys.enable')}</button>
              <button onClick={() => regenerate(key)}>{t('keys.regenerate')}</button>
              <button class="danger-link" onClick={() => deleteKey(key.id)}>{t('common.delete')}</button>
            </div>
          </div>
        )}</For></div>
      </section>

      <Show when={editKey()}>{(key) => (
        <div class="modal-backdrop" onClick={() => setEditKey(null)}>
          <form class="modal-card form-stack" onSubmit={saveEdit} onClick={(e) => e.stopPropagation()}>
            <div class="modal-title"><div><span class="eyebrow">Key</span><h3>{t('keys.editTitle')}</h3><p>{key().key_prefix}••••</p></div><button type="button" onClick={() => setEditKey(null)}>×</button></div>
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
