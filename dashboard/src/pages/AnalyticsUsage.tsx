import { createSignal, onMount, Show, For, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import { t } from '../i18n';

interface AnalyticsSummary {
  requests: number;
  successes: number;
  errors: number;
  cancelled: number;
  fallbacks: number;
  input_tokens: number;
  output_tokens: number;
  usage_unknown: number;
  cost_micros: number;
  avg_latency_ms: number | null;
  avg_ttft_ms: number | null;
  ttft_count: number;
  latency_count: number;
}

interface AnalyticsModelRow extends AnalyticsSummary {
  model_card_id: string;
  unified_model_id: string;
}

interface AnalyticsTrendPoint {
  bucket: number;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
}

interface AnalyticsUsageResponse {
  range: { start: number; end: number };
  summary: AnalyticsSummary;
  models: AnalyticsModelRow[];
  trends: AnalyticsTrendPoint[];
}

const RANGE_LABELS: Record<string, string> = { today: '', '7d': '', '30d': '' };

function formatUsd(costMicros: number): string {
  if (costMicros === 0) return '$0';
  const usd = costMicros / 1_000_000;
  if (usd >= 10) return `$${usd.toFixed(2)}`;
  if (usd >= 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function fmtNum(n = 0): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function pct(part: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((part / total) * 100)}%`;
}

export default function AnalyticsUsage() {
  const [data, setData] = createSignal<AnalyticsUsageResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [range, setRange] = createSignal('today');
  const [granularity, setGranularity] = createSignal<'hour' | 'day' | ''>('');
  const [modelId, setModelId] = createSignal('');
  const [keyId, setKeyId] = createSignal('');
  const [modelOptions, setModelOptions] = createSignal<{ id: string; name: string }[]>([]);
  const [keyOptions, setKeyOptions] = createSignal<{ id: string; name: string }[]>([]);

  const fetchUsage = async (r: string, g: string, m: string, k: string) => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ range: r });
      if (g) query.set('granularity', g);
      if (m) query.set('model_id', m);
      if (k) query.set('key_id', k);
      const response = await fetch(`/admin/api/analytics/usage?${query}`);
      if (!response.ok) throw new Error(t('usage.loadFailed'));
      setData(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('usage.loadFailed'));
    } finally { setLoading(false); }
  };

  const applyRange = (r: string) => {
    setRange(r);
    void fetchUsage(r, granularity(), modelId(), keyId());
  };

  const applyGranularity = (g: 'hour' | 'day' | '') => {
    setGranularity(g);
    void fetchUsage(range(), g, modelId(), keyId());
  };

  const applyFilters = () => {
    void fetchUsage(range(), granularity(), modelId(), keyId());
  };

  const fetchOptions = async () => {
    try {
      const [modelsRes, keysRes] = await Promise.all([
        fetch('/admin/api/models'),
        fetch('/admin/api/keys'),
      ]);
      if (modelsRes.ok) {
        const arr = (await modelsRes.json()) as Array<{ id: string; unified_model_id: string }>;
        setModelOptions(arr.map((m) => ({ id: m.unified_model_id, name: m.unified_model_id })));
      }
      if (keysRes.ok) {
        const arr = (await keysRes.json()) as Array<{ id: string; name: string }>;
        setKeyOptions(arr.map((k) => ({ id: k.id, name: k.name })));
      }
    } catch { /* filters not critical */ }
  };

  onMount(() => { void fetchUsage('today', '', '', ''); void fetchOptions(); });

  const summary = () => data()?.summary;
  const models = () => data()?.models ?? [];
  const trends = () => data()?.trends ?? [];

  const successRate = () => {
    const s = summary();
    if (!s || s.requests === 0) return null;
    return Math.round((s.successes / s.requests) * 100);
  };
  const usageCoverage = () => {
    const s = summary();
    if (!s || s.requests === 0) return 100;
    return Math.round(((s.requests - s.usage_unknown) / s.requests) * 100);
  };

  // SVG trend sparkline
  const trendSvg = () => {
    const pts = trends();
    if (pts.length === 0) return null;
    const values = pts.map((p) => p.requests);
    const max = Math.max(...values, 1);
    const w = pts.length > 1 ? 100 / (pts.length - 1) : 100;
    const points = values.map((v, i) => `${(i * w).toFixed(1)},${(100 - (v / max) * 100).toFixed(1)}`).join(' ');
    return (
      <svg class="analytics-trend-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    );
  };

  return (
    <div class="analytics-page">
      <div class="analytics-page-nav">
        <div class="analytics-segment-tabs">
          <A href="/analytics/usage" class="analytics-segment-tab active">{t('nav.analyticsUsage')}</A>
          <A href="/analytics/logs" class="analytics-segment-tab">{t('nav.analyticsLogs')}</A>
        </div>
        <div class="analytics-range-tabs">
          <For each={['today', '7d', '30d'] as const}>{(item) => (
            <button classList={{ active: range() === item }} onClick={() => applyRange(item)}>
              {RANGE_LABELS[item] || (item === 'today' ? t('dash.today') : `${t('usage.past')} ${item === '7d' ? '7' : '30'} ${t('usage.days')}`)}
            </button>
          )}</For>
        </div>
      </div>

      <div class="analytics-filters">
        <label>{t('common.model')}
          <select value={modelId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setModelId(next);
            void fetchUsage(range(), granularity(), next, keyId());
          }}>
            <option value="">{t('usage.allModels')}</option>
            <For each={modelOptions()}>{(m) => <option value={m.id}>{m.name}</option>}</For>
          </select>
        </label>
        <label>{t('common.key')}
          <select value={keyId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setKeyId(next);
            void fetchUsage(range(), granularity(), modelId(), next);
          }}>
            <option value="">{t('usage.allKeys')}</option>
            <For each={keyOptions()}>{(k) => <option value={k.id}>{k.name}</option>}</For>
          </select>
        </label>
        <label>{t('usage.granularity')}
          <select value={granularity()} onChange={(e) => applyGranularity(e.currentTarget.value as 'hour' | 'day' | '')}>
            <option value="">5 {t('usage.minutes')}</option>
            <option value="hour">{t('usage.hourly')}</option>
            <option value="day">{t('usage.daily')}</option>
          </select>
        </label>
      </div>

      <Show when={loading()}><div class="analytics-skeleton"><div class="skeleton-cards"><span /><span /><span /><span /><span /></div><div class="skeleton-table" /></div></Show>

      <Show when={!loading() && error()}>
        <div class="panel analytics-error-state"><strong>{t('usage.loadFailed')}</strong><span>{error()}</span><button class="secondary-button" onClick={applyFilters}>{t('common.retry')}</button></div>
      </Show>

      <Show when={!loading() && !error() && data()}>
        {/* Metric cards: left high Token + cost, right 2x2 */}
        <div class="analytics-card-layout">
          <div class="analytics-metric-card analytics-token-highlight">
            <small>{t('usage.totalTokens')}</small>
            <strong>{fmtNum((summary()?.input_tokens ?? 0) + (summary()?.output_tokens ?? 0))}</strong>
            <div class="analytics-token-breakdown">
              <span>{t('usage.input')} {fmtNum(summary()?.input_tokens)}</span>
              <span>{t('usage.output')} {fmtNum(summary()?.output_tokens)}</span>
            </div>
            <Show when={(summary()?.usage_unknown ?? 0) > 0}>
              <span class="coverage-warn">{t('usage.coverage')} {usageCoverage()}%</span>
            </Show>
            <div class="analytics-cost-row">
              <small>{t('usage.estCost')}</small>
              <strong>{formatUsd(summary()?.cost_micros ?? 0)}</strong>
            </div>
          </div>
          <div class="analytics-right-grid">
            <div class="analytics-metric-card">
              <small>{t('usage.requests')}</small>
              <strong>{fmtNum(summary()?.requests)}</strong>
              <span>{successRate() !== null ? `${t('usage.successRate')} ${successRate()}%` : '—'}</span>
            </div>
            <div class="analytics-metric-card">
              <small>{t('usage.avgLatency')}</small>
              <strong>{summary()?.avg_latency_ms != null ? `${summary()!.avg_latency_ms}ms` : '—'}</strong>
              <span>{summary()?.latency_count ?? 0} {t('usage.samples')}</span>
            </div>
            <div class="analytics-metric-card">
              <small>{t('usage.avgTtft')}</small>
              <strong>{summary()?.avg_ttft_ms != null ? `${summary()!.avg_ttft_ms}ms` : '—'}</strong>
              <span>{t('usage.streamOnly')} · {summary()?.ttft_count ?? 0} {t('usage.samples')}</span>
            </div>
            <div class="analytics-metric-card">
              <small>{t('usage.successRate')}</small>
              <strong>{successRate() !== null ? `${successRate()}%` : '—'}</strong>
              <span>{t('usage.errors')} {fmtNum(summary()?.errors)} · {t('usage.fallbacks')} {fmtNum(summary()?.fallbacks)}</span>
            </div>
          </div>
        </div>

        {/* Trend sparkline */}
        <Show when={trends().length > 0}>
          <div class="panel analytics-trend-panel">
            <div class="panel-header"><h2>{t('usage.trends')}</h2><span class="analytics-hint">{t('usage.requestsChange')}</span></div>
            <div class="analytics-trend-chart">{trendSvg()}</div>
          </div>
        </Show>

        {/* Model table */}
        <Show when={models().length > 0}>
          <div class="panel analytics-model-panel">
            <div class="panel-header"><h2>{t('usage.modelsTable')}</h2><span class="analytics-hint">{t('usage.sortedByRequests')}</span></div>
            <div class="analytics-model-table">
              <div class="analytics-model-head">
                <span>{t('common.model')}</span><span>{t('usage.requests')}</span><span>{t('usage.successRate')}</span><span>{t('usage.avgTpm')}</span><span>{t('usage.avgLatency')}</span><span>{t('usage.avgTtft')}</span><span>Token ({t('usage.inOut')})</span><span>{t('usage.cost')}</span>
              </div>
              <For each={models()}>{(model) => (
                <div class="analytics-model-row">
                  <span class="amodel-name"><code>{model.unified_model_id}</code></span>
                  <span>{fmtNum(model.requests)}</span>
                  <span>{pct(model.successes, model.requests)}</span>
                  <span class="amodel-muted">{model.requests > 0 ? fmtNum(Math.round(model.input_tokens / model.requests)) : '—'}</span>
                  <span class="amodel-muted">{model.avg_latency_ms != null ? `${model.avg_latency_ms}ms` : '—'}</span>
                  <span class="amodel-muted">{model.avg_ttft_ms != null ? `${model.avg_ttft_ms}ms` : '—'}</span>
                  <span class="amodel-tokens">{fmtNum(model.input_tokens)} / {fmtNum(model.output_tokens)}</span>
                  <span class="amodel-cost">{formatUsd(model.cost_micros)}</span>
                </div>
              )}</For>
            </div>
          </div>
        </Show>

        <Show when={!loading() && models().length === 0 && (summary()?.requests ?? 0) === 0}>
          <div class="panel empty-state">
            <span class="provider-logo">A</span>
            <h3>{t('usage.noData')}</h3>
            <p>{t('usage.noDataBody')}</p>
          </div>
        </Show>
      </Show>
    </div>
  );
}
