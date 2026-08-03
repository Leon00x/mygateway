import { createSignal, onMount } from 'solid-js';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  status: string;
  created_at: number;
}

export default function ApiKeys() {
  const [keys, setKeys] = createSignal<ApiKey[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [newKeyName, setNewKeyName] = createSignal('');
  const [revealedKey, setRevealedKey] = createSignal('');

  const fetchKeys = async () => {
    try {
      const resp = await fetch('/admin/api/keys');
      if (resp.ok) setKeys(await resp.json());
    } catch {}
    setLoading(false);
  };

  onMount(fetchKeys);

  const createKey = async (e: Event) => {
    e.preventDefault();
    const resp = await fetch('/admin/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName() }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setRevealedKey(data.key);
      setNewKeyName('');
      fetchKeys();
    }
  };

  const deleteKey = async (id: string) => {
    if (!confirm('Delete this key? It will immediately stop working.')) return;
    await fetch(`/admin/api/keys/${id}`, { method: 'DELETE' });
    fetchKeys();
  };

  return (
    <div>
      <h2 class="text-xl font-bold mb-6">API Keys</h2>

      {revealedKey() && (
        <div class="bg-green-900/30 border border-green-700 rounded-lg p-4 mb-4">
          <p class="text-sm text-green-300 mb-2">Copy this key now — it won't be shown again:</p>
          <code class="text-sm break-all select-all">{revealedKey()}</code>
          <button onClick={() => setRevealedKey('')} class="ml-3 text-xs text-[var(--color-muted)]">Dismiss</button>
        </div>
      )}

      <form onSubmit={createKey} class="flex gap-3 mb-6">
        <input
          placeholder="Key name"
          value={newKeyName()}
          onInput={(e) => setNewKeyName(e.currentTarget.value)}
          class="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm flex-1"
        />
        <button type="submit" class="px-4 py-2 bg-[var(--color-primary)] text-white rounded text-sm">
          Create Key
        </button>
      </form>

      {loading() && <p class="text-[var(--color-muted)]">Loading...</p>}

      <div class="space-y-3">
        {keys().map((k) => (
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 flex items-center justify-between">
            <div>
              <p class="font-medium">{k.name}</p>
              <p class="text-xs text-[var(--color-muted)] font-mono">{k.key_prefix}...</p>
            </div>
            <div class="flex items-center gap-3">
              <span class={`text-xs px-2 py-0.5 rounded ${k.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                {k.status}
              </span>
              <button onClick={() => deleteKey(k.id)} class="text-xs text-red-400 hover:text-red-300">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
