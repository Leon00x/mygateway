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

/** Local-midnight unix seconds for a YYYY-MM-DD value. */
function dateToUnix(value: string): number {
  if (!value) return 0;
  return Math.floor(new Date(`${value}T00:00:00`).getTime() / 1000);
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

export default function AnalyticsUsage() {
  const [data, setData] = createSignal<AnalyticsUsageResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [range, setRange] = createSignal<RangeKey>('today');
  const [customStart, setCustomStart] = createSignal(todayInputValue());
  const [customEnd, setCustomEnd] = createSignal(todayInputValue());
  const [granularity, setGranularity] = createSignal<'hour' | 'day' | ''>('');
  const [modelId, setModelId] = createSignal('');
  const [keyId, setKeyId] = createSignal('');
  const [modelOptions, setModelOptions] = createSignal<{ id: string; name: string }[]>([]);
  const [keyOptions, setKeyOptions] = createSignal<{ id: string; name: string }[]>([]);

  const fetchUsage = async (r: RangeKey, g: string, m: string, k: string, start?: string, end?: string) => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if (r === 'custom' && start && end) {
        query.set('range', 'custom');
        query.set('start', String(dateToUnix(start)));
        // End date inclusive → next local midnight
        query.set('end', String(dateToUnix(end) + 86_400));
      } else {
        query.set('range', r);
      }
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

  const applyRange = (r: RangeKey) => {
    setRange(r);
    if (r === 'custom') {
      void fetchUsage(r, granularity(), modelId(), keyId(), customStart(), customEnd());
    } else {
      void fetchUsage(r, granularity(), modelId(), keyId());
    }
  };

  const applyCustom = () => {
    setRange('custom');
    void fetchUsage('custom', granularity(), modelId(), keyId(), customStart(), customEnd());
  };

  const applyGranularity = (g: 'hour' | 'day' | '') => {
    setGranularity(g);
    void fetchUsage(range(), g, modelId(), keyId(), customStart(), customEnd());
  };

  const applyFilters = () => {
    void fetchUsage(range(), granularity(), modelId(), keyId(), customStart(), customEnd());
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

  // SVG trend sparkline with grid
  const trendSvg = () => {
    const pts = trends();
    if (pts.length === 0) return null;
    const values = pts.map((p) => p.requests);
    const max = Math.max(...values, 1);
    const w = pts.length > 1 ? 100 / (pts.length - 1) : 100;
    const points = values.map((v, i) => `${(i * w).toFixed(1)},${(100 - (v / max) * 100).toFixed(1)}`).join(' ');
    const grid = [25, 50, 75].map((y) => (
      <line x1="0" y1={y} x2="100" y2={y} stroke="currentColor" stroke-opacity="0.12" stroke-width="0.5" />
    ));
    return (
      <svg class="analytics-trend-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {grid}
        <polyline points={points} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    );
  };

  const rangeButtons: { key: RangeKey; label: string }[] = [
    { key: 'today', label: t('dash.today') },
    { key: 'yesterday', label: t('usage.yesterday') },
    { key: '7d', label: t('usage.last7d') },
    { key: '30d', label: t('usage.last30d') },
    { key: 'custom', label: t('usage.custom') },
  ];

  return (
    <div class="analytics-page">
      <div class="analytics-page-nav">
        <div class="analytics-segment-tabs">
          <A href="/analytics/usage" class="analytics-segment-tab active">{t('nav.analyticsUsage')}</A>
          <A href="/analytics/logs" class="analytics-segment-tab">{t('nav.analyticsLogs')}</A>
        </div>
      </div>

      {/* QwenCloud-style range picker: quick buttons + custom date range */}
      <div class="analytics-range-bar">
        <div class="analytics-range-buttons">
          <For each={rangeButtons}>{(btn) => (
            <button classList={{ active: range() === btn.key }} onClick={() => applyRange(btn.key)}>
              {btn.label}
            </button>
          )}</For>
        </div>
        <div class="analytics-custom-range">
          <input type="date" value={customStart()} max={customEnd()} onInput={(e) => setCustomStart(e.currentTarget.value)} />
          <span>→</span>
          <input type="date" value={customEnd()} min={customStart()} onInput={(e) => setCustomEnd(e.currentTarget.value)} />
          <button class="secondary-button" onClick={applyCustom}>{t('common.apply')}</button>
        </div>
      </div>

      {/* Filters */}
      <div class="analytics-filters">
        <label>{t('common.model')}
          <select value={modelId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setModelId(next);
            void fetchUsage(range(), granularity(), next, keyId(), customStart(), customEnd());
          }}>
            <option value="">{t('usage.allModels')}</option>
            <For each={modelOptions()}>{(m) => <option value={m.id}>{m.name}</option>}</For>
          </select>
        </label>
        <label>{t('common.key')}
          <select value={keyId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setKeyId(next);
            void fetchUsage(range(), granularity(), modelId(), next, customStart(), customEnd());
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
        {/* QwenCloud-style metric cards: requests / avg latency / avg TTFT / success rate */}
        <div class="analytics-metrics-grid">
          <div class="analytics-metric-card">
            <div class="analytics-metric-top"><small>{t('usage.requests')}</small><span class="analytics-metric-spark">{trends().length > 1 ? trendSvg() : null}</span></div>
            <strong>{fmtNum(summary()?.requests)}</strong>
            <p>{t('usage.requestsDesc')}</p>
          </div>
          <div class="analytics-metric-card">
            <small>{t('usage.avgLatency')}</small>
            <strong>{summary()?.avg_latency_ms != null ? `${summary()!.avg_latency_ms}ms` : '—'}</strong>
            <p>{t('usage.avgLatencyDesc')}</p>
          </div>
          <div class="analytics-metric-card">
            <small>{t('usage.avgTtft')}</small>
            <strong>{summary()?.avg_ttft_ms != null ? `${summary()!.avg_ttft_ms}ms` : '—'}</strong>
            <p>{t('usage.avgTtftDesc')}</p>
          </div>
          <div class="analytics-metric-card">
            <small>{t('usage.successRate')}</small>
            <strong>{successRate() !== null ? `${successRate()}%` : '—'}</strong>
            <p>{t('usage.successRateDesc')}</p>
          </div>
        </div>

        {/* Token consumption card */}
        <div class="panel analytics-token-card">
          <div class="analytics-token-head">
            <div><h3>{t('usage.tokenConsumption')}</h3><p>{t('usage.tokenConsumptionDesc')}</p></div>
            <span class="analytics-token-total">{t('usage.totalTokens')} <strong>{fmtNum((summary()?.input_tokens ?? 0) + (summary()?.output_tokens ?? 0))}</strong></span>
          </div>
          <div class="analytics-token-row">
            <div><small>{t('usage.input')}</small><strong>{fmtNum(summary()?.input_tokens)}</strong></div>
            <div><small>{t('usage.output')}</small><strong>{fmtNum(summary()?.output_tokens)}</strong></div>
            <div><small>{t('usage.coverage')}</small><strong>{usageCoverage()}%</strong></div>
            <div><small>{t('usage.estCost')}</small><strong>{formatUsd(summary()?.cost_micros ?? 0)}</strong></div>
          </div>
        </div>

        {/* Trend chart */}
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
