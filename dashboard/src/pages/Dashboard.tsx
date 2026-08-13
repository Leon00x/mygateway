import { createSignal, onCleanup, onMount, Show, For } from 'solid-js';
import { A } from '@solidjs/router';
import Icon, { IconName } from '../components/Icon';
import { t } from '../i18n';
import { ProviderLogo } from '../components/ProviderLogo';
import {
  balanceCurrencySymbol,
  balanceUpdatedAt,
  mergeProviderBalances,
  type ProviderBalance,
  type ProviderBalancesResponse,
} from '../provider-balances';

interface UsageOverview { requests: number; successes: number; errors: number; input_tokens: number; cache_input_tokens: number; output_tokens: number; usage_unknown: number; fallbacks?: number; cost_micros?: number; }
interface ApiKey { id: string; name: string; key_prefix: string; status: string; expires_at: number | null; is_temporary: boolean; }
interface Channel { id: string; name: string; provider_type: string; base_url: string; status: string; }
interface ModelItem { id: string; unified_model_id: string; display_name: string; status: string; created_at: number; }

const shortcuts: { href: string; label: string; note: string; icon: IconName }[] = [
  { href: '/channels', label: t('dash.addChannel'), note: t('dash.connectProvider'), icon: 'channels' },
  { href: '/models', label: t('dash.configureModels'), note: t('dash.setRouting'), icon: 'models' },
  { href: '/keys', label: t('dash.createKey'), note: t('dash.openApi'), icon: 'keys' },
  { href: '/v1/api-docs', label: t('dash.apiDocs'), note: t('dash.viewSpec'), icon: 'docs' },
];

const protocols = ['/chat/completions', '/responses', '/messages'];
const TEMP_KEY_STORAGE = 'mygateway.quickstartTempKey';

function themedShortcutHref(href: string, theme: 'light' | 'dark'): string {
  if (!href.startsWith('/v1/api-docs')) return href;
  return `${href}?theme=${theme}`;
}

interface StoredTempKey {
  key: string;
  expiresAt: number;
}

function readStoredTempKey(): StoredTempKey | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMP_KEY_STORAGE) ?? 'null') as Partial<StoredTempKey> | null;
    if (typeof parsed?.key === 'string' && typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now()) {
      return { key: parsed.key, expiresAt: parsed.expiresAt };
    }
    localStorage.removeItem(TEMP_KEY_STORAGE);
  } catch { /* storage can be unavailable or contain stale data */ }
  return null;
}

export default function Dashboard() {
  const [overview, setOverview] = createSignal<UsageOverview | null>(null);
  const [range, setRange] = createSignal<'today' | '7d' | '30d'>('today');
  const [loading, setLoading] = createSignal(true);
  const [keys, setKeys] = createSignal<ApiKey[]>([]);
  const [models, setModels] = createSignal<ModelItem[]>([]);
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [balances, setBalances] = createSignal<ProviderBalance[]>([]);
  const [balanceBusy, setBalanceBusy] = createSignal(false);
  const [copied, setCopied] = createSignal('');
  const [publicUrl, setPublicUrl] = createSignal(window.location.origin);
  const baseUrl = () => `${publicUrl()}/v1`;
  const [protocolPath, setProtocolPath] = createSignal('/chat/completions');
  const [protocolOpen, setProtocolOpen] = createSignal(false);
  const endpointUrl = () => baseUrl() + protocolPath();
  const protocolLabel = () => protocols.includes(protocolPath()) ? protocolPath() : protocols[0];
  const [tempKey, setTempKey] = createSignal('');
  const [tempKeyExpiresAt, setTempKeyExpiresAt] = createSignal(0);
  const [tempBusy, setTempBusy] = createSignal(false);
  const [tempCopied, setTempCopied] = createSignal(false);
  const [tempError, setTempError] = createSignal('');
  const [docsTheme, setDocsTheme] = createSignal<'light' | 'dark'>(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  let tempExpiryTimer: ReturnType<typeof setTimeout> | undefined;

  const fetchOverview = async () => {
    const response = await fetch(`/admin/api/usage/overview?range=${range()}`);
    if (response.ok) setOverview(await response.json());
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const responses = await Promise.all([
        fetch(`/admin/api/usage/overview?range=${range()}`), fetch('/admin/api/keys'),
        fetch('/admin/api/models'), fetch('/admin/api/channels'), fetch('/admin/api/channels/balances'),
        fetch('/admin/api/system/public-url'),
      ]);
      if (responses[0].ok) setOverview(await responses[0].json());
      if (responses[1].ok) setKeys(await responses[1].json());
      if (responses[2].ok) setModels(await responses[2].json());
      if (responses[3].ok) setChannels(await responses[3].json());
      if (responses[4].ok) {
        const incoming = ((await responses[4].json()) as ProviderBalancesResponse).balances;
        setBalances(mergeProviderBalances(incoming));
      }
      if (responses[5].ok) {
        const configured = (await responses[5].json()) as { public_url: string | null };
        if (configured.public_url) setPublicUrl(configured.public_url);
      }
    } finally { setLoading(false); }
  };
  const refreshKeys = async () => {
    const response = await fetch('/admin/api/keys');
    if (response.ok) setKeys(await response.json());
  };

  const clearTempKey = () => {
    setTempKey('');
    setTempKeyExpiresAt(0);
    try { localStorage.removeItem(TEMP_KEY_STORAGE); } catch { /* storage may be unavailable */ }
    if (tempExpiryTimer) clearTimeout(tempExpiryTimer);
    tempExpiryTimer = undefined;
  };

  const keepTempKeyUntilExpiry = (key: string, expiresAtSeconds: number) => {
    const expiresAt = expiresAtSeconds * 1000;
    setTempKey(key);
    setTempKeyExpiresAt(expiresAt);
    try { localStorage.setItem(TEMP_KEY_STORAGE, JSON.stringify({ key, expiresAt } satisfies StoredTempKey)); } catch { /* storage may be unavailable */ }
    if (tempExpiryTimer) clearTimeout(tempExpiryTimer);
    tempExpiryTimer = setTimeout(clearTempKey, Math.max(0, expiresAt - Date.now()));
  };

  onMount(() => {
    void fetchData();
    const stored = readStoredTempKey();
    if (stored) keepTempKeyUntilExpiry(stored.key, Math.floor(stored.expiresAt / 1000));
  });
  onMount(() => {
    const closeProtocolPicker = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.protocol-picker')) setProtocolOpen(false);
    };
    document.addEventListener('click', closeProtocolPicker);
    onCleanup(() => document.removeEventListener('click', closeProtocolPicker));
  });
  onMount(() => {
    const observer = new MutationObserver(() => {
      setDocsTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => { if (tempExpiryTimer) clearTimeout(tempExpiryTimer); });

  const copyTempCommand = async (key = tempKey()) => {
    try {
      await navigator.clipboard.writeText(curlExample(baseUrl(), quickstartModel(), key));
      setTempCopied(true);
      setTimeout(() => setTempCopied(false), 2000);
    } catch {
      setTempError(t('dash.copyFailed'));
    }
  };

  const createTempKey = async () => {
    if (tempKey() && tempKeyExpiresAt() > Date.now()) {
      await copyTempCommand();
      return;
    }
    setTempBusy(true);
    setTempError('');
    try {
      const response = await fetch('/admin/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: t('dash.tempKeyName'),
          temporary: true,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setTempError(data?.error?.message ?? t('dash.tempKeyFailed'));
        return;
      }
      const data = (await response.json()) as { key: string; expires_at: number | null };
      if (!data.expires_at) throw new Error('Temporary key expiry missing');
      keepTempKeyUntilExpiry(data.key, data.expires_at);
      await copyTempCommand(data.key);
      void refreshKeys();
    } catch {
      setTempError(t('dash.tempKeyFailed'));
    } finally {
      setTempBusy(false);
    }
  };

  const changeRange = (value: 'today' | '7d' | '30d') => {
    setRange(value);
    setLoading(true);
    void fetchOverview().finally(() => setLoading(false));
  };
  const refreshBalances = async () => {
    setBalanceBusy(true);
    try {
      const response = await fetch('/admin/api/channels/balances?refresh=1&active=1');
      if (response.ok) {
        const incoming = ((await response.json()) as ProviderBalancesResponse).balances;
        setBalances(mergeProviderBalances(incoming));
      }
    } finally { setBalanceBusy(false); }
  };
  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(''), 1800);
  };
  const activeKeys = () => keys().filter((item) => item.status === 'active' && (!item.expires_at || item.expires_at * 1000 > Date.now()));
  const activeModels = () => models().filter((item) => item.status === 'active');
  const quickstartModel = () => [...activeModels()]
    .sort((a, b) => a.created_at - b.created_at)[0]?.unified_model_id;
  const activeChannels = () => channels().filter((item) => item.status === 'active');
  const visibleBalances = () => {
    const activeIds = new Set(activeChannels().map((item) => item.id));
    return balances().filter((item) => activeIds.has(item.channel_id));
  };
  const successRate = () => overview()?.requests ? Math.round((overview()!.successes / overview()!.requests) * 100) : 0;
  const cacheHitRate = () => {
    const input = overview()?.input_tokens ?? 0;
    return input > 0 ? Math.round(((overview()?.cache_input_tokens ?? 0) / input) * 1000) / 10 : 0;
  };
  const spendLabel = () => {
    const micros = overview()?.cost_micros ?? 0;
    return micros > 0 ? `$${(micros / 1_000_000).toFixed(4)}` : '—';
  };
  const fmt = (value = 0) => value.toLocaleString();

  return (
    <div class="dashboard-stack">
      <section class="shortcut-panel panel">
        <For each={shortcuts}>{(item) => (
          <A
            href={themedShortcutHref(item.href, docsTheme())}
            class="shortcut-item"
            target={item.href.startsWith('/v1') ? '_blank' : undefined}
            onClick={(event) => {
              if (item.href.startsWith('/v1/api-docs')) {
                event.currentTarget.href = themedShortcutHref(item.href, docsTheme());
              }
            }}
          >
            <span class="shortcut-icon"><Icon name={item.icon} size={21} /></span>
            <span><strong>{item.label}</strong><small>{item.note}</small></span><b>↗</b>
          </A>
        )}</For>
      </section>

      <section class="metric-grid">
        <Metric title={t('dash.requests')} value={fmt(overview()?.requests)} note={range() === 'today' ? t('dash.today') : `${range()}`} tone="violet" />
        <Metric title={t('dash.successRate')} value={`${successRate()}%`} note={`${fmt(overview()?.successes)} ${t('dash.successes')}`} tone="green" />
        <Metric title={t('dash.tokens')} value={fmt((overview()?.input_tokens ?? 0) + (overview()?.output_tokens ?? 0))} tone="orange" />
        <Metric title={t('dash.cacheHitRate')} value={`${cacheHitRate()}%`} note={overview()?.cache_input_tokens ? `${fmt(overview()!.cache_input_tokens)} ${t('dash.cacheTokens')}` : t('dash.noCacheData')} tone="teal" />
        <Metric title={t('dash.spend')} value={spendLabel()} note={t('dash.byPrice')} tone="blue" />
      </section>

      <section class="dashboard-main-grid">
        <div class="panel endpoint-panel">
          <div class="panel-header">
            <div><h2>{t('dash.endpoint')}</h2><p>{t('dash.endpointSub')}</p></div>
            <span class="badge active">{t('dash.available')}</span>
          </div>
          <div class="endpoint-body">
            <div class="code-line">
              <code>{baseUrl()}</code>
              <div class="code-line-actions">
                <div class="protocol-picker">
                  <button type="button" class="protocol-trigger" aria-expanded={protocolOpen()} onClick={(e) => { e.stopPropagation(); setProtocolOpen(!protocolOpen()); }}>
                    <span>{protocolLabel()}</span>
                    <svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 1l3.5 3.5L8 1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
                  </button>
                  <Show when={protocolOpen()}>
                    <div class="protocol-menu">
                      <For each={protocols}>{(p) => (
                        <button type="button" classList={{ active: p === protocolPath() }} onClick={() => { setProtocolPath(p); setProtocolOpen(false); }}>
                          {p}<Show when={p === protocolPath()}><span class="check">✓</span></Show>
                        </button>
                      )}</For>
                    </div>
                  </Show>
                </div>
                <button class="copy-btn" onClick={() => copy(endpointUrl(), 'url')}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="3.5" y="3.5" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.4" /><path d="M8.5 3.5V2.8A1.3 1.3 0 0 0 7.2 1.5H2.8A1.3 1.3 0 0 0 1.5 2.8v4.4a1.3 1.3 0 0 0 1.3 1.3h.7" stroke="currentColor" stroke-width="1.4" /></svg>
                  {copied() === 'url' ? t('dash.copied') : t('dash.copy')}
                </button>
              </div>
            </div>
            <div class="resource-summary">
              <div><small>{t('dash.channels')}</small><strong>{activeChannels().length}</strong></div>
              <div><small>{t('dash.models')}</small><strong>{activeModels().length}</strong></div>
              <div><small>{t('dash.keys')}</small><strong>{activeKeys().length}</strong></div>
            </div>
            <Show when={activeChannels().length || activeModels().length}>
              <div class="tag-section">
                <For each={activeChannels()}>{(channel) => <span class="soft-tag"><i />{channel.name}</span>}</For>
                <For each={activeModels()}>{(model) => <span class="soft-tag model">{model.unified_model_id}</span>}</For>
              </div>
            </Show>
          </div>
        </div>

        <div class="panel usage-panel">
          <div class="panel-header">
            <div><h2>{t('dash.usageTitle')}</h2><p>{t('dash.usageSub')}</p></div>
            <div class="range-tabs">
              <For each={['today','7d','30d'] as const}>{(item) => <button classList={{ active: range() === item }} onClick={() => changeRange(item)}>{item === 'today' ? t('dash.today') : item}</button>}</For>
            </div>
          </div>
          <div class="usage-bars">
            <UsageBar label={t('dash.input')} value={overview()?.input_tokens ?? 0} max={(overview()?.input_tokens ?? 0) + (overview()?.output_tokens ?? 0)} />
            <UsageBar label={t('dash.output')} value={overview()?.output_tokens ?? 0} max={(overview()?.input_tokens ?? 0) + (overview()?.output_tokens ?? 0)} accent />
            <UsageBar label={t('dash.unknownUsage')} value={overview()?.usage_unknown ?? 0} max={overview()?.requests ?? 0} subtle />
            <Show when={loading()}><span class="loading-line">{t('dash.refreshing')}</span></Show>
          </div>
        </div>
      </section>

      <Show when={visibleBalances().length > 0}>
        <section class="panel provider-balance-panel">
          <div class="panel-header">
            <div><h2>{t('dash.providerBalance')}</h2><p>{t('dash.providerBalanceSub')}</p></div>
            <button class="secondary-button" disabled={balanceBusy()} onClick={refreshBalances}>
              {balanceBusy() ? t('dash.querying') : t('dash.refreshBalance')}
            </button>
          </div>
          <div class="provider-balance-list">
            <For each={visibleBalances()}>{(balance) => (
              <div class="provider-balance-row">
                <div class="provider-balance-name"><ProviderLogo presetId="deepseek" name="DeepSeek" /><div><strong>{balance.channel_name}</strong><small>{t('dash.officialApi')}</small></div></div>
                <Show when={balance.status === 'not_queried'}><span class="balance-state muted">{t('dash.clickToQuery')}</span></Show>
                <Show when={balance.status === 'error'}><span class="balance-state error">{balance.status === 'error' ? balance.error : ''}</span></Show>
                <Show when={balance.status === 'ok' ? balance : undefined}>{(resolved) => {
                  const current = resolved();
                  if (current.status !== 'ok') return null;
                  return <div class="provider-balance-values">
                    <span class={`balance-state ${current.is_available ? 'available' : 'unavailable'}`}>{current.is_available ? t('dash.accountAvailable') : t('dash.accountUnavailable')}</span>
                    <For each={current.balance_infos}>{(item) => (
                      <div class="provider-balance-value">
                        <small>{item.currency} {t('dash.balanceTotal')}</small>
                        <strong>{balanceCurrencySymbol(item.currency)}{item.total_balance}</strong>
                        <span>{t('dash.balanceGranted')} {balanceCurrencySymbol(item.currency)}{item.granted_balance} · {t('dash.balanceToppedUp')} {balanceCurrencySymbol(item.currency)}{item.topped_up_balance}</span>
                      </div>
                    )}</For>
                    <small class="balance-updated">{balanceUpdatedAt(current.fetched_at)}{current.cached ? ` · ${t('dash.cached')}` : ''}</small>
                  </div>;
                }}</Show>
              </div>
            )}</For>
          </div>
        </section>
      </Show>

      <section class="panel quickstart-panel">
        <div class="panel-header">
          <div><h2>{t('dash.quickstart')}</h2><p>{t('dash.quickstartSub')}</p></div>
          <div class="action-row">
            <button class="secondary-button" onClick={() => copy(curlExample(baseUrl(), quickstartModel(), tempKey() || 'YOUR_GATEWAY_KEY'), 'curl')}><Icon name="copy" size={15} />{copied() === 'curl' ? t('dash.copied') : t('dash.copyCmd')}</button>
            <button class="primary-button" disabled={tempBusy()} onClick={createTempKey}><Icon name={tempKey() ? 'copy' : 'keys'} size={15} />{tempBusy() ? t('dash.creatingTempKey') : tempCopied() ? t('dash.tempKeyCopied') : tempKey() ? t('dash.copyTempKey') : t('dash.createTempKey')}</button>
          </div>
        </div>
        <Show when={tempKey()}>
          <small class="quickstart-hint">{t('dash.tempKeyStoredUntil')} {new Date(tempKeyExpiresAt()).toLocaleString()}</small>
        </Show>
        <Show when={tempError()}><div class="form-error quickstart-error">{tempError()}</div></Show>
        <pre>{curlExample(baseUrl(), quickstartModel(), tempKey() || 'YOUR_GATEWAY_KEY')}</pre>
      </section>
    </div>
  );
}

function curlExample(baseUrl: string, model = 'your-model', token = 'YOUR_GATEWAY_KEY') {
  return `curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`;
}

function Metric(props: { title: string; value: string; note?: string; tone: string }) {
  return <div class={`metric-card panel ${props.tone}`}><span class="metric-dot"/><small>{props.title}</small><strong>{props.value}</strong><Show when={props.note}><p>{props.note}</p></Show></div>;
}

function UsageBar(props: { label: string; value: number; max: number; accent?: boolean; subtle?: boolean }) {
  const width = () => props.max > 0 ? Math.max(3, Math.round((props.value / props.max) * 100)) : 0;
  return <div class="usage-row"><div><span>{props.label}</span><strong>{props.value.toLocaleString()}</strong></div><div class="bar-track"><i classList={{ accent: props.accent, subtle: props.subtle }} style={{ width: `${width()}%` }}/></div></div>;
}
