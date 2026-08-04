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
    <div class="resource-page">
      <div class="page-heading">
        <div><h2>Provider Channels</h2><p>API Key 将加密保存，调用时仅在 Worker 内解密。</p></div>
        <div class="action-row">
          <button onClick={() => setShowCustom(!showCustom())} class="secondary-button">自定义渠道</button>
          <button onClick={openPreset} class="primary-button">+ 添加供应商</button>
        </div>
      </div>

      {/* Preset Modal */}
      <Show when={showPreset()}>
        <div class="modal-backdrop" onClick={() => setShowPreset(false)}>
          <div class="modal-card" onClick={(e) => e.stopPropagation()}>

            <Show when={presetStep() === 'select'}>
              <div class="modal-title"><div><span class="eyebrow">Quick connect</span><h3>选择供应商</h3></div><button onClick={() => setShowPreset(false)}>×</button></div>
              <div class="provider-grid">
                <For each={PROVIDER_PRESETS}>
                  {(p) => (
                    <button onClick={() => pickPreset(p)} class="provider-option">
                      <div class="provider-option-top">
                        <span class="provider-logo">{p.name.slice(0, 1)}</span>
                        <div>
                          <strong>{p.name}</strong>
                          <p>{p.description}</p>
                        </div>
                      </div>
                      <div class="provider-models">
                        <For each={p.popular_models.slice(0, 2)}>{(m) => <span>{m}</span>}</For>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show when={presetStep() === 'configure' && selectedPreset()}>
              <button onClick={() => setPresetStep('select')} class="back-button">← 返回供应商列表</button>
              <div class="modal-title"><div><span class="eyebrow">Configure</span><h3>添加 {selectedPreset()!.name}</h3><p>{selectedPreset()!.base_url}</p></div></div>
              <form onSubmit={submitPreset} class="form-stack">
                <label>API Key</label>
                <input type="password" value={presetApiKey()} onInput={(e) => setPresetApiKey(e.currentTarget.value)} placeholder="sk-..." required
                />
                <Show when={presetError()}><div class="form-error">{presetError()}</div></Show>
                <div class="modal-actions">
                  <button type="button" onClick={() => setShowPreset(false)} class="secondary-button">取消</button>
                  <button type="submit" disabled={presetBusy()} class="primary-button">
                    {presetBusy() ? '添加中...' : '确认添加'}
                  </button>
                </div>
              </form>
            </Show>
          </div>
        </div>
      </Show>

      {/* Custom Form */}
      <Show when={showCustom()}>
        <form onSubmit={submitCustom} class="panel inline-form">
          <div class="inline-form-title"><div><h3>自定义渠道</h3><p>连接任意兼容 OpenAI Chat Completions 的 HTTPS API。</p></div><button type="button" onClick={() => setShowCustom(false)}>×</button></div>
          <div class="form-grid">
          <label>渠道名称<input placeholder="Name" value={cName()} onInput={(e) => setCName(e.currentTarget.value)} required /></label>
          <label>协议类型<select value={cType()} onChange={(e) => setCType(e.currentTarget.value)}>
            <option value="openai">OpenAI</option>
            <option value="openai_compatible">OpenAI Compatible</option>
          </select></label>
          <label>Base URL<input placeholder="Base URL (https://...)" value={cUrl()} onInput={(e) => setCUrl(e.currentTarget.value)} required /></label>
          <label>API Key<input type="password" placeholder="API Key" value={cKey()} onInput={(e) => setCKey(e.currentTarget.value)} required /></label>
          </div>
          <Show when={cError()}><div class="form-error">{cError()}</div></Show>
          <div class="inline-form-actions"><button type="submit" disabled={cBusy()} class="primary-button">{cBusy() ? 'Creating...' : 'Create'}</button></div>
        </form>
      </Show>

      <section class="panel resource-list">
        <div class="panel-header"><div><h3>已连接渠道</h3><p>{channels().length} 个 Provider 配置</p></div></div>
      {loading() && <p class="empty-state">Loading...</p>}
      <Show when={!loading() && channels().length === 0}><div class="empty-state"><span class="provider-logo">+</span><h3>还没有渠道</h3><p>从右上角添加第一个模型供应商。</p></div></Show>
      <div class="resource-rows">
        <For each={channels()}>
          {(ch) => (
            <div class="resource-row">
              <span class="provider-logo">{ch.name.slice(0, 1).toUpperCase()}</span>
              <div class="resource-main">
                <strong>{ch.name}</strong>
                <span>{ch.provider_type} · <code>{ch.base_url}</code></span>
              </div>
              <div class="row-actions">
                <span class={`badge ${ch.status}`}>{ch.status === 'active' ? '运行中' : '已停用'}</span>
                <button onClick={() => test(ch.id)}>测试</button>
                <button onClick={() => toggleStatus(ch)}>{ch.status === 'active' ? '停用' : '启用'}</button>
                <button onClick={[del, ch.id]} class="danger-link">删除</button>
              </div>
            </div>
          )}
        </For>
      </div>
      </section>
    </div>
  );
}
