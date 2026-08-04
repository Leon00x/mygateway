import { createSignal, onMount, For, Show } from 'solid-js';
import { PROVIDER_PRESETS, ProviderPreset } from '../presets';
import {
  balanceCurrencySymbol,
  balanceUpdatedAt,
  type ProviderBalance,
  type ProviderBalancesResponse,
} from '../provider-balances';

interface Channel {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  has_api_key: boolean;
  status: string;
  notes: string | null;
  protocols: Array<{ protocol: string; base_url: string }>;
}

export default function Channels() {
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [balances, setBalances] = createSignal<Record<string, ProviderBalance>>({});
  const [balanceBusy, setBalanceBusy] = createSignal<Record<string, boolean>>({});

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
  const [cProtocols, setCProtocols] = createSignal<string[]>(['openai_chat']);
  const [cError, setCErr] = createSignal('');
  const [cBusy, setCBusy] = createSignal(false);

  const refresh = async () => {
    try {
      const r = await fetch('/admin/api/channels');
      if (r.ok) setChannels(await r.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const loadBalanceCache = async () => {
    try {
      const response = await fetch('/admin/api/channels/balances');
      if (!response.ok) return;
      const data = await response.json() as ProviderBalancesResponse;
      setBalances(Object.fromEntries(data.balances.map((item) => [item.channel_id, item])));
    } catch (error) { console.error(error); }
  };

  const refreshBalance = async (channelId: string) => {
    setBalanceBusy((current) => ({ ...current, [channelId]: true }));
    try {
      const response = await fetch(`/admin/api/channels/${channelId}/balance?refresh=1`);
      const data = await response.json() as ProviderBalance | { error?: string };
      if ('channel_id' in data) {
        setBalances((current) => ({ ...current, [channelId]: data }));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setBalanceBusy((current) => ({ ...current, [channelId]: false }));
    }
  };

  onMount(() => { void Promise.all([refresh(), loadBalanceCache()]); });

  const toggleStatus = async (ch: Channel) => {
    await fetch(`/admin/api/channels/${ch.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: ch.status === 'active' ? 'disabled' : 'active' }),
    });
    void Promise.all([refresh(), loadBalanceCache()]);
  };

  const del = async (id: string) => {
    if (!confirm('Delete this channel?')) return;
    const r = await fetch(`/admin/api/channels/${id}`, { method: 'DELETE' });
    if (!r.ok) alert('Cannot delete — channel may be in use by models');
    void Promise.all([refresh(), loadBalanceCache()]);
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
        body: JSON.stringify({
          name: p.name,
          provider_type: p.provider_type,
          base_url: p.base_url,
          api_key: presetApiKey(),
          protocols: p.protocols,
        }),
      });
      if (r.ok) {
        setShowPreset(false);
        void Promise.all([refresh(), loadBalanceCache()]);
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
        body: JSON.stringify({
          name: cName(),
          provider_type: cType(),
          base_url: cUrl(),
          api_key: cKey(),
          protocols: cProtocols().map((protocol) => ({
            protocol,
            base_url: cUrl(),
            auth_scheme: protocol === 'anthropic_messages' ? 'x_api_key' : 'bearer',
            ...(protocol === 'anthropic_messages' ? { api_version: '2023-06-01' } : {}),
          })),
        }),
      });
      if (r.ok) {
        setShowCustom(false);
        setCName(''); setCUrl(''); setCKey(''); setCProtocols(['openai_chat']);
        void Promise.all([refresh(), loadBalanceCache()]);
      } else {
        const d = await r.json();
        setCErr(d.error?.message ?? 'Failed');
      }
    } catch (e: any) { setCErr(e.message); }
    setCBusy(false);
  };

  const toggleCustomProtocol = (protocol: string, checked: boolean) => {
    setCProtocols((current) => checked
      ? [...new Set([...current, protocol])]
      : current.filter((item) => item !== protocol));
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
              <div class="modal-title"><div><span class="eyebrow">Configure</span><h3>添加 {selectedPreset()!.name}</h3><p>{selectedPreset()!.base_url}</p><a class="provider-doc-link" href={selectedPreset()!.docs_url} target="_blank" rel="noreferrer">查看官方接入文档 ↗</a></div></div>
              <form onSubmit={submitPreset} class="form-stack">
                <label>API Key</label>
                <input type="password" value={presetApiKey()} onInput={(e) => setPresetApiKey(e.currentTarget.value)} placeholder="sk-..." required
                />
                <div class="provider-models">
                  <For each={selectedPreset()!.protocols}>{(item) => <span>{item.protocol}</span>}</For>
                </div>
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
          <div class="inline-form-title"><div><h3>自定义渠道</h3><p>一份 API Key 可连接一个或多个 Chat、Responses、Messages HTTPS 端点。</p></div><button type="button" onClick={() => setShowCustom(false)}>×</button></div>
          <div class="form-grid">
          <label>渠道名称<input placeholder="Name" value={cName()} onInput={(e) => setCName(e.currentTarget.value)} required /></label>
          <label>协议类型<select value={cType()} onChange={(e) => setCType(e.currentTarget.value)}>
            <option value="openai">OpenAI</option>
            <option value="openai_compatible">OpenAI Compatible</option>
          </select></label>
          <label>Base URL<input placeholder="Base URL (https://...)" value={cUrl()} onInput={(e) => setCUrl(e.currentTarget.value)} required /></label>
          <label>API Key<input type="password" placeholder="API Key" value={cKey()} onInput={(e) => setCKey(e.currentTarget.value)} required /></label>
          </div>
          <div class="protocol-options">
            <strong>原生协议（至少一个）</strong>
            <label class="checkbox-label"><input type="checkbox" checked={cProtocols().includes('openai_chat')} onChange={(e) => toggleCustomProtocol('openai_chat', e.currentTarget.checked)} />OpenAI Chat</label>
            <label class="checkbox-label"><input type="checkbox" checked={cProtocols().includes('openai_responses')} onChange={(e) => toggleCustomProtocol('openai_responses', e.currentTarget.checked)} />OpenAI Responses</label>
            <label class="checkbox-label"><input type="checkbox" checked={cProtocols().includes('anthropic_messages')} onChange={(e) => toggleCustomProtocol('anthropic_messages', e.currentTarget.checked)} />Anthropic Messages</label>
          </div>
          <Show when={cError()}><div class="form-error">{cError()}</div></Show>
          <div class="inline-form-actions"><button type="submit" disabled={cBusy() || cProtocols().length === 0} class="primary-button">{cBusy() ? 'Creating...' : 'Create'}</button></div>
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
                <div class="provider-models"><For each={ch.protocols}>{(item) => <span>{item.protocol}</span>}</For></div>
                <Show when={balances()[ch.id]}>{(balance) => (
                  <div class="channel-balance">
                    <span class="balance-label">DeepSeek 余额</span>
                    <Show when={balance().status === 'not_queried'}>
                      <span class="balance-state muted">尚未查询</span>
                    </Show>
                    <Show when={balance().status === 'error'}>
                      <span class="balance-state error">查询失败：{balance().status === 'error' ? balance().error : ''}</span>
                    </Show>
                    <Show when={balance().status === 'ok'}>{() => {
                      const current = balance();
                      if (current.status !== 'ok') return null;
                      return <>
                        <span class={`balance-state ${current.is_available ? 'available' : 'unavailable'}`}>
                          {current.is_available ? '可用' : '不可用'}
                        </span>
                        <For each={current.balance_infos}>{(item) => (
                          <span class="balance-amount">
                            <strong>{balanceCurrencySymbol(item.currency)}{item.total_balance}</strong>
                            <small>赠金 {balanceCurrencySymbol(item.currency)}{item.granted_balance} · 充值 {balanceCurrencySymbol(item.currency)}{item.topped_up_balance}</small>
                          </span>
                        )}</For>
                        <small class="balance-updated">更新于 {balanceUpdatedAt(current.fetched_at)}{current.cached ? ' · 缓存' : ''}</small>
                      </>;
                    }}</Show>
                  </div>
                )}</Show>
              </div>
              <div class="row-actions">
                <span class={`badge ${ch.status}`}>{ch.status === 'active' ? '运行中' : '已停用'}</span>
                <Show when={balances()[ch.id]}>
                  <button disabled={balanceBusy()[ch.id]} onClick={() => refreshBalance(ch.id)}>
                    {balanceBusy()[ch.id] ? '查询中…' : balances()[ch.id]?.status === 'not_queried' ? '查询余额' : '刷新余额'}
                  </button>
                </Show>
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
