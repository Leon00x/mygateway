import { createSignal, onMount, For, Show } from 'solid-js';

interface ApiKey { id: string; name: string; key_prefix: string; status: string; created_at: number; }

export default function ApiKeys() {
  const [keys, setKeys] = createSignal<ApiKey[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [newKeyName, setNewKeyName] = createSignal('');
  const [revealedKey, setRevealedKey] = createSignal('');

  const fetchKeys = async () => {
    try { const response = await fetch('/admin/api/keys'); if (response.ok) setKeys(await response.json()); }
    finally { setLoading(false); }
  };
  onMount(fetchKeys);

  const createKey = async (event: Event) => {
    event.preventDefault();
    const response = await fetch('/admin/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newKeyName() }) });
    if (response.ok) { const data = await response.json(); setRevealedKey(data.key); setNewKeyName(''); void fetchKeys(); }
  };
  const toggleKey = async (key: ApiKey) => {
    await fetch(`/admin/api/keys/${key.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: key.status === 'active' ? 'disabled' : 'active' }) });
    void fetchKeys();
  };
  const regenerate = async (key: ApiKey) => {
    if (!confirm(`Regenerate ${key.name}? The current key will stop working immediately.`)) return;
    const response = await fetch(`/admin/api/keys/${key.id}/regenerate`, { method: 'POST' });
    if (response.ok) { setRevealedKey((await response.json()).key); void fetchKeys(); }
  };
  const deleteKey = async (id: string) => {
    if (!confirm('Delete this key? It will immediately stop working.')) return;
    await fetch(`/admin/api/keys/${id}`, { method: 'DELETE' }); void fetchKeys();
  };

  return (
    <div class="resource-page">
      <div class="page-heading"><div><h2>Gateway API Keys</h2><p>客户端通过这些密钥访问统一模型接口。</p></div></div>
      <Show when={revealedKey()}>
        <div class="secret-reveal panel"><div><span class="eyebrow">仅显示一次</span><h3>复制并安全保存这个密钥</h3><code>{revealedKey()}</code></div><button class="secondary-button" onClick={() => navigator.clipboard.writeText(revealedKey())}>复制密钥</button><button class="secret-close" onClick={() => setRevealedKey('')}>×</button></div>
      </Show>
      <form onSubmit={createKey} class="panel key-create">
        <div><h3>创建新密钥</h3><p>使用容易识别的名称标记调用方或应用。</p></div>
        <input placeholder="Key name" value={newKeyName()} onInput={(e) => setNewKeyName(e.currentTarget.value)} required />
        <button type="submit" class="primary-button">＋ Create Key</button>
      </form>
      <section class="panel resource-list">
        <div class="panel-header"><div><h3>密钥列表</h3><p>{keys().filter((key) => key.status === 'active').length} 个有效密钥</p></div></div>
        {loading() && <p class="empty-state">Loading...</p>}
        <Show when={!loading() && keys().length === 0}><div class="empty-state"><span class="provider-logo">K</span><h3>还没有 API Key</h3><p>创建一个密钥开始调用网关。</p></div></Show>
        <div class="resource-rows"><For each={keys()}>{(key) => (
          <div class="resource-row">
            <span class="provider-logo key-logo">K</span>
            <div class="resource-main"><strong>{key.name}</strong><span><code>{key.key_prefix}••••••••••••</code> · 创建于 {new Date(key.created_at * 1000).toLocaleDateString()}</span></div>
            <div class="row-actions"><span class={`badge ${key.status}`}>{key.status === 'active' ? '有效' : '已停用'}</span><button onClick={() => toggleKey(key)}>{key.status === 'active' ? '停用' : '启用'}</button><button onClick={() => regenerate(key)}>重新生成</button><button class="danger-link" onClick={() => deleteKey(key.id)}>删除</button></div>
          </div>
        )}</For></div>
      </section>
    </div>
  );
}
