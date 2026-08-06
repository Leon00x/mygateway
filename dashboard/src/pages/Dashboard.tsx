import { createSignal, onMount, Show, For } from 'solid-js';
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

interface UsageOverview { requests: number; successes: number; errors: number; input_tokens: number; output_tokens: number; usage_unknown: number; fallbacks?: number; cost_micros?: number; }
interface ApiKey { id: string; name: string; key_prefix: string; status: string; }
interface Channel { id: string; name: string; provider_type: string; base_url: string; status: string; }
interface ModelItem { id: string; unified_model_id: string; display_name: string; status: string; }

const shortcuts: { href: string; label: string; note: string; icon: IconName }[] = [
  { href: '/channels', label: t('dash.addChannel'), note: t('dash.connectProvider'), icon: 'channels' },
  { href: '/models', label: t('dash.configureModels'), note: t('dash.setRouting'), icon: 'models' },
  { href: '/keys', label: t('dash.createKey'), note: t('dash.openApi'), icon: 'keys' },
  { href: '/v1/api-docs', label: t('dash.apiDocs'), note: t('dash.viewSpec'), icon: 'docs' },
];

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
  const baseUrl = () => `${window.location.origin}/v1`;

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
      ]);
      if (responses[0].ok) setOverview(await responses[0].json());
      if (responses[1].ok) setKeys(await responses[1].json());
      if (responses[2].ok) setModels(await responses[2].json());
      if (responses[3].ok) setChannels(await responses[3].json());
      if (responses[4].ok) {
        const incoming = ((await responses[4].json()) as ProviderBalancesResponse).balances;
        setBalances(mergeProviderBalances(incoming));
      }
    } finally { setLoading(false); }
  };
  onMount(fetchData);

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
  const activeKeys = () => keys().filter((item) => item.status === 'active');
  const activeModels = () => models().filter((item) => item.status === 'active');
  const activeChannels = () => channels().filter((item) => item.status === 'active');
  const visibleBalances = () => {
    const activeIds = new Set(activeChannels().map((item) => item.id));
    return balances().filter((item) => activeIds.has(item.channel_id));
  };
  const successRate = () => overview()?.requests ? Math.round((overview()!.successes / overview()!.requests) * 100) : 0;
  const usageCoverage = () => overview()?.requests
    ? Math.round(((overview()!.requests - overview()!.usage_unknown) / overview()!.requests) * 100)
    : 100;
  const spendLabel = () => {
    const micros = overview()?.cost_micros ?? 0;
    return micros > 0 ? `$${(micros / 1_000_000).toFixed(4)}` : '—';
  };
  const fmt = (value = 0) => value.toLocaleString();

  return (
    <div class="dashboard-stack">
      <section class="shortcut-panel panel">
        <For each={shortcuts}>{(item) => (
          <A href={item.href} class="shortcut-item" target={item.href.startsWith('/v1') ? '_blank' : undefined}>
            <span class="shortcut-icon"><Icon name={item.icon} size={21} /></span>
            <span><strong>{item.label}</strong><small>{item.note}</small></span><b>↗</b>
          </A>
        )}</For>
      </section>

      <section class="metric-grid">
        <Metric title={t('dash.requests')} value={fmt(overview()?.requests)} note={range() === 'today' ? t('dash.today') : `${range()}`} tone="violet" />
        <Metric title={t('dash.successRate')} value={`${successRate()}%`} note={`${fmt(overview()?.successes)} ${t('dash.successes')}`} tone="green" />
        <Metric title={t('dash.tokens')} value={fmt((overview()?.input_tokens ?? 0) + (overview()?.output_tokens ?? 0))} note={`${t('dash.providerReported')} ${usageCoverage()}%`} tone="orange" />
        <Metric title={t('dash.spend')} value={spendLabel()} note={t('dash.byPrice')} tone="blue" />
      </section>

      <section class="dashboard-main-grid">
        <div class="panel endpoint-panel">
          <div class="panel-header">
            <div><h2>{t('dash.endpoint')}</h2><p>{t('dash.endpointSub')}</p></div>
            <span class="badge active">{t('dash.available')}</span>
          </div>
          <div class="endpoint-body">
            <div class="code-line"><code>{baseUrl()}</code><button onClick={() => copy(baseUrl(), 'url')}>{copied() === 'url' ? t('dash.copied') : t('dash.copy')}</button></div>
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
                <Show when={balance.status === 'ok'}>{() => {
                  if (balance.status !== 'ok') return null;
                  return <div class="provider-balance-values">
                    <span class={`balance-state ${balance.is_available ? 'available' : 'unavailable'}`}>{balance.is_available ? t('dash.accountAvailable') : t('dash.accountUnavailable')}</span>
                    <For each={balance.balance_infos}>{(item) => (
                      <div class="provider-balance-value">
                        <small>{item.currency} {t('dash.balanceTotal')}</small>
                        <strong>{balanceCurrencySymbol(item.currency)}{item.total_balance}</strong>
                        <span>{t('dash.balanceGranted')} {balanceCurrencySymbol(item.currency)}{item.granted_balance} · {t('dash.balanceToppedUp')} {balanceCurrencySymbol(item.currency)}{item.topped_up_balance}</span>
                      </div>
                    )}</For>
                    <small class="balance-updated">{balanceUpdatedAt(balance.fetched_at)}{balance.cached ? ` · ${t('dash.cached')}` : ''}</small>
                  </div>;
                }}</Show>
              </div>
            )}</For>
          </div>
        </section>
      </Show>

      <section class="panel quickstart-panel">
        <div class="panel-header"><div><h2>{t('dash.quickstart')}</h2><p>{t('dash.quickstartSub')}</p></div><button class="secondary-button" onClick={() => copy(curlExample(baseUrl(), activeModels()[0]?.unified_model_id), 'curl')}>{copied() === 'curl' ? t('dash.copied') : t('dash.copyCmd')}</button></div>
        <pre>{curlExample(baseUrl(), activeModels()[0]?.unified_model_id)}</pre>
      </section>
    </div>
  );
}

function curlExample(baseUrl: string, model = 'your-model') {
  return `curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`;
}

function Metric(props: { title: string; value: string; note: string; tone: string }) {
  return <div class={`metric-card panel ${props.tone}`}><span class="metric-dot"/><small>{props.title}</small><strong>{props.value}</strong><p>{props.note}</p></div>;
}

function UsageBar(props: { label: string; value: number; max: number; accent?: boolean; subtle?: boolean }) {
  const width = () => props.max > 0 ? Math.max(3, Math.round((props.value / props.max) * 100)) : 0;
  return <div class="usage-row"><div><span>{props.label}</span><strong>{props.value.toLocaleString()}</strong></div><div class="bar-track"><i classList={{ accent: props.accent, subtle: props.subtle }} style={{ width: `${width()}%` }}/></div></div>;
}
