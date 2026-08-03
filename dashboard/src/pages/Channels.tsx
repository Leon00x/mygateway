import { createSignal, onMount, For, Show } from 'solid-js';
import { PROVIDER_PRESETS, ProviderPreset } from '../presets';

interface Channel {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  has_api_key: boolean;
  status: string;
  notes: string | null;
}

export default function Channels() {
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [loading, setLoading] = createSignal(true);

  const [showPreset, setShowPreset] = createSignal(false);
  const [presetStep, setPresetStep] = createSignal<'select' | 'configure'>('select');
  const [selectedPreset, setSelectedPreset] = createSignal<ProviderPreset | null>(null);
  const [presetApiKey, setPresetApiKey] = createSignal('');
  const [presetError, setPresetError] = createSignal('');
  const [presetBusy, setPresetBusy] = createSignal(false);

  const [showCustom, setShowCustom] = createSignal(false);
  const [cName, setCName] = createSignal('');
  const [cType, setCType] = createSignal('openai_compatible');
  const [cUrl, setCUrl] = createSignal('');
  const [cKey, setCKey] = createSignal('');
  const [cError, setCErr] = createSignal('');
  const [cBusy, setCBusy] = createSignal(false);

  const refresh = async () => {
    try {
      const r = await fetch('/admin/api/channels');
      if (r.ok) setChannels(await r.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  onMount(refresh);

  const toggleStatus = async (ch: Channel) => {
    await fetch(`/admin/api/channels/${ch.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: ch.status === 'active' ? 'disabled' : 'active' }),
    });
    refresh();
  };

  const del = async (id: string) => {
    if (!confirm('Delete this channel?')) return;
    const r = await fetch(`/admin/api/channels/${id}`, { method: 'DELETE' });
    if (!r.ok) alert('Cannot delete — channel may be in use by models');
    refresh();
  };

  const test = async (id: string) => {
    const r = await fetch(`/admin/api/channels/${id}/test`, { method: 'POST' });
    const d = await r.json();
    alert(d.ok ? `✓ Connected (${d.elapsed_ms}ms)` : `✗ ${d.error ?? 'Failed'} (${d.elapsed_ms ?? '?'}ms)`);
  };

  const openPreset = () => {
    setPresetStep('select');
    setSelectedPreset(null);
    setPresetApiKey('');
    setPresetError('');
    setShowPreset(true);
  };

  const pickPreset = (p: ProviderPreset) => {
    setSelectedPreset(p);
    setPresetStep('configure');
    setPresetApiKey('');
    setPresetError('');
  };

  const submitPreset = async (e: Event) => {
    e.preventDefault();
    const p = selectedPreset();
    if (!p || !presetApiKey()) return;
    setPresetBusy(true);
    setPresetError('');
    try {
      const r = await fetch('/admin/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: p.name, provider_type: p.provider_type, base_url: p.base_url, api_key: presetApiKey() }),
      });
      if (r.ok) {
        setShowPreset(false);
        refresh();
      } else {
        const d = await r.json();
        setPresetError(d.error?.message ?? 'Failed');
      }
    } catch (e: any) { setPresetError(e.message); }
    setPresetBusy(false);
  };

  const submitCustom = async (e: Event) => {
    e.preventDefault();
    setCBusy(true);
    setCErr('');
    try {
      const r = await fetch('/admin/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cName(), provider_type: cType(), base_url: cUrl(), api_key: cKey() }),
      });
      if (r.ok) {
        setShowCustom(false);
        setCName(''); setCUrl(''); setCKey('');
        refresh();
      } else {
        const d = await r.json();
        setCErr(d.error?.message ?? 'Failed');
      }
    } catch (e: any) { setCErr(e.message); }
    setCBusy(false);
  };

  return (
    <div>
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold">Channels</h2>
        <div class="flex gap-2">
          <button onClick={openPreset} class="px-3 py-1.5 bg-[var(--color-primary)] text-white rounded text-sm font-medium hover:opacity-90">
            + 添加供应商
          </button>
          <button onClick={[setShowCustom, (v: boolean) => !v]} class="px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] rounded text-sm hover:text-white">
            自定义
          </button>
        </div>
      </div>

      {/* Preset Modal */}
      <Show when={showPreset()}>
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowPreset(false)}>
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-6 w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>

            <Show when={presetStep() === 'select'}>
              <h3 class="text-base font-bold mb-4">选择供应商</h3>
              <div class="space-y-2">
                <For each={PROVIDER_PRESETS}>
                  {(p) => (
                    <button onClick={() => pickPreset(p)} class="w-full text-left bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-primary)] transition-colors">
                      <div class="flex items-start justify-between">
                        <div>
                          <p class="font-medium text-sm">{p.name}</p>
                          <p class="text-xs text-[var(--color-muted)] mt-0.5">{p.description}</p>
                        </div>
                        <a href={p.docs_url} target="_blank" class="text-xs text-[var(--color-primary)] hover:underline shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>📄</a>
                      </div>
                      <div class="flex flex-wrap gap-1 mt-2">
                        <For each={p.popular_models}>{(m) => <span class="text-[10px] bg-[var(--color-surface)] px-1.5 py-0.5 rounded font-mono">{m}</span>}</For>
                      </div>
                      <p class="text-[10px] text-[var(--color-muted)] mt-2 font-mono">{p.base_url}</p>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show when={presetStep() === 'configure' && selectedPreset()}>
              <button onClick={() => setPresetStep('select')} class="text-xs text-[var(--color-muted)] hover:text-white mb-3 inline-block">← 返回</button>
              <h3 class="text-base font-bold mb-1">添加 {selectedPreset()!.name}</h3>
              <p class="text-xs text-[var(--color-muted)] mb-4">
                <a href={selectedPreset()!.docs_url} target="_blank" class="text-[var(--color-primary)] hover:underline">📄 获取 API Key</a>
                <span class="ml-2 font-mono">{selectedPreset()!.base_url}</span>
              </p>
              <form onSubmit={submitPreset}>
                <label class="block text-xs text-[var(--color-muted)] mb-1.5">API Key</label>
                <input type="password" value={presetApiKey()} onInput={(e) => setPresetApiKey(e.currentTarget.value)} placeholder="sk-..." required
                  class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm mb-2 focus:border-[var(--color-primary)] outline-none" />
                <Show when={presetError()}><p class="text-xs text-red-400 mb-2">{presetError()}</p></Show>
                <div class="flex gap-2 mt-3">
                  <button type="submit" disabled={presetBusy()} class="flex-1 py-2 bg-[var(--color-primary)] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50">
                    {presetBusy() ? '添加中...' : '确认添加'}
                  </button>
                  <button type="button" onClick={() => setShowPreset(false)} class="px-4 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm">取消</button>
                </div>
              </form>
            </Show>
          </div>
        </div>
      </Show>

      {/* Custom Form */}
      <Show when={showCustom()}>
        <form onSubmit={submitCustom} class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 mb-4 space-y-3">
          <p class="text-sm font-medium">自定义渠道</p>
          <input placeholder="Name" value={cName()} onInput={(e) => setCName(e.currentTarget.value)} class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm" required />
          <select value={cType()} onChange={(e) => setCType(e.currentTarget.value)} class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm">
            <option value="openai">OpenAI</option>
            <option value="openai_compatible">OpenAI Compatible</option>
          </select>
          <input placeholder="Base URL (https://...)" value={cUrl()} onInput={(e) => setCUrl(e.currentTarget.value)} class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm" required />
          <input type="password" placeholder="API Key" value={cKey()} onInput={(e) => setCKey(e.currentTarget.value)} class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm" required />
          <Show when={cError()}><p class="text-xs text-red-400">{cError()}</p></Show>
          <button type="submit" disabled={cBusy()} class="px-4 py-2 bg-[var(--color-primary)] text-white rounded text-sm disabled:opacity-50">{cBusy() ? 'Creating...' : 'Create'}</button>
        </form>
      </Show>

      {/* List */}
      {loading() && <p class="text-[var(--color-muted)]">Loading...</p>}
      <div class="space-y-3">
        <For each={channels()}>
          {(ch) => (
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 flex items-center justify-between">
              <div>
                <p class="font-medium">{ch.name}</p>
                <p class="text-xs text-[var(--color-muted)] font-mono">{ch.provider_type} · {ch.base_url}</p>
              </div>
              <div class="flex items-center gap-3">
                <span class={`text-xs px-2 py-0.5 rounded ${ch.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>{ch.status}</span>
                <button onClick={() => test(ch.id)} class="text-xs text-[var(--color-primary)] hover:underline">Test</button>
                <button onClick={() => toggleStatus(ch)} class="text-xs text-[var(--color-muted)] hover:text-white">Toggle</button>
                <button onClick={[del, ch.id]} class="text-xs text-red-400 hover:text-red-300">Delete</button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
