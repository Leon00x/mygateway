import { createSignal, onMount, For, Show } from 'solid-js';

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
  if (key.rpm_limit) parts.push(`≤${key.rpm_limit} 次/分`);
  if (key.daily_request_limit) parts.push(`≤${key.daily_request_limit} 次/日`);
  if (key.daily_token_limit) parts.push(`≤${(key.daily_token_limit / 1_000_000).toLocaleString()}M token/日`);
  if (key.model_allowlist.length) parts.push(`${key.model_allowlist.length} 个模型`);
  if (key.expires_at) parts.push(`${new Date(key.expires_at * 1000).toLocaleDateString()} 到期`);
  return parts.length ? parts.join(' · ') : '无限制';
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
      setCreateError(data.error?.message ?? '创建失败');
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
    else { const data = await response.json(); setEditError(data.error?.message ?? '保存失败'); }
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
    if (!confirm(`重新生成 ${key.name}？当前密钥将立即失效。`)) return;
    const response = await fetch(`/admin/api/keys/${key.id}/regenerate`, { method: 'POST' });
    if (response.ok) { setRevealedKey((await response.json()).key); void fetchKeys(); }
  };
  const deleteKey = async (id: string) => {
    if (!confirm('删除这个密钥？它将立即失效。')) return;
    await fetch(`/admin/api/keys/${id}`, { method: 'DELETE' });
    void fetchKeys();
  };

  const limitFields = (
    form: () => KeyForm,
    setForm: (next: KeyForm) => void,
  ) => (
    <div class="model-bind-fields key-limit-fields">
      <label>每分钟请求上限（RPM）
        <input type="number" min="0" placeholder="不限" value={form().rpm}
          onInput={(e) => setForm({ ...form(), rpm: e.currentTarget.value })} />
      </label>
      <label>每日请求上限
        <input type="number" min="0" placeholder="不限" value={form().dailyRequests}
          onInput={(e) => setForm({ ...form(), dailyRequests: e.currentTarget.value })} />
      </label>
      <label>每日 Token 上限
        <input type="number" min="0" placeholder="不限" value={form().dailyTokens}
          onInput={(e) => setForm({ ...form(), dailyTokens: e.currentTarget.value })} />
      </label>
      <label>有效期（天，0 = 永不过期）
        <input type="number" min="0" placeholder="0" value={form().expiresDays}
          onInput={(e) => setForm({ ...form(), expiresDays: e.currentTarget.value })} />
      </label>
      <label class="key-allowlist">可用模型白名单（逗号分隔，留空 = 全部）
        <input placeholder="deepseek-chat, gpt-4o" value={form().allowlist}
          onInput={(e) => setForm({ ...form(), allowlist: e.currentTarget.value })} />
        <small>客户端只能用列表内的统一模型 ID 调用。</small>
      </label>
    </div>
  );

  return (
    <div class="resource-page">
      <div class="page-heading"><div><h2>Gateway API Keys</h2><p>创建带限流、预算和模型白名单的访问密钥。</p></div></div>

      <Show when={revealedKey()}>
        <div class="secret-reveal panel"><div><span class="eyebrow">仅显示一次</span><h3>复制并安全保存这个密钥</h3><code>{revealedKey()}</code></div><button class="secondary-button" onClick={() => navigator.clipboard.writeText(revealedKey())}>复制密钥</button><button class="secret-close" onClick={() => setRevealedKey('')}>×</button></div>
      </Show>

      <form onSubmit={createKey} class="panel key-create key-create-form">
        <div><h3>创建新密钥</h3><p>使用容易识别的名称标记调用方或应用。</p></div>
        <input placeholder="Key name" value={createForm().name}
          onInput={(e) => setCreateForm({ ...createForm(), name: e.currentTarget.value })} required />
        <div class="key-create-actions">
          <button type="button" class="secondary-button" onClick={() => setShowLimits(!showLimits())}>
            {showLimits() ? '收起限额设置' : '限额设置'}
          </button>
          <button type="submit" class="primary-button" disabled={busy()}>＋ Create Key</button>
        </div>
        <Show when={showLimits()}>{limitFields(createForm, setCreateForm)}</Show>
        <Show when={createError()}><div class="form-error">{createError()}</div></Show>
      </form>

      <section class="panel resource-list">
        <div class="panel-header"><div><h3>密钥列表</h3><p>{keys().filter((key) => key.status === 'active').length} 个有效密钥</p></div></div>
        {loading() && <p class="empty-state">Loading...</p>}
        <Show when={!loading() && keys().length === 0}><div class="empty-state"><span class="provider-logo">K</span><h3>还没有 API Key</h3><p>创建一个密钥开始调用网关。</p></div></Show>
        <div class="resource-rows"><For each={keys()}>{(key) => (
          <div class="resource-row key-row">
            <span class="provider-logo key-logo">K</span>
            <div class="resource-main">
              <strong>{key.name}</strong>
              <span><code>{key.key_prefix}••••••••••••</code> · 创建于 {new Date(key.created_at * 1000).toLocaleDateString()}</span>
              <span class="key-limits-hint">{limitsSummary(key)}</span>
            </div>
            <div class="row-actions">
              <span class={`badge ${key.status}`}>{key.status === 'active' ? '有效' : '已停用'}</span>
              <button onClick={() => openEdit(key)}>编辑限额</button>
              <button onClick={() => toggleKey(key)}>{key.status === 'active' ? '停用' : '启用'}</button>
              <button onClick={() => regenerate(key)}>重新生成</button>
              <button class="danger-link" onClick={() => deleteKey(key.id)}>删除</button>
            </div>
          </div>
        )}</For></div>
      </section>

      <Show when={editKey()}>{(key) => (
        <div class="modal-backdrop" onClick={() => setEditKey(null)}>
          <form class="modal-card form-stack" onSubmit={saveEdit} onClick={(e) => e.stopPropagation()}>
            <div class="modal-title"><div><span class="eyebrow">Key</span><h3>编辑密钥</h3><p>{key().key_prefix}••••</p></div><button type="button" onClick={() => setEditKey(null)}>×</button></div>
            <label>名称<input value={editForm().name} onInput={(e) => setEditForm({ ...editForm(), name: e.currentTarget.value })} required /></label>
            {limitFields(editForm, setEditForm)}
            <Show when={editError()}><div class="form-error">{editError()}</div></Show>
            <div class="modal-actions"><button type="button" class="secondary-button" onClick={() => setEditKey(null)}>取消</button><button type="submit" disabled={busy()} class="primary-button">{busy() ? '保存中…' : '保存'}</button></div>
          </form>
        </div>
      )}</Show>
    </div>
  );
}
