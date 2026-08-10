import { createSignal, onMount, Show, For, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import { t } from '../i18n';
import TimeRangePicker, { resolvePreset, type TimeRange } from '../components/TimeRangePicker';

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


export default function AnalyticsUsage() {
  const [data, setData] = createSignal<AnalyticsUsageResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [timeRange, setTimeRange] = createSignal<TimeRange>({ preset: '1w', ...resolvePreset('1w') });
  const [granularity, setGranularity] = createSignal<'hour' | 'day' | ''>('');
  const [modelId, setModelId] = createSignal('');
  const [keyId, setKeyId] = createSignal('');
  const [modelOptions, setModelOptions] = createSignal<{ id: string; name: string }[]>([]);
  const [keyOptions, setKeyOptions] = createSignal<{ id: string; name: string }[]>([]);

  const fetchUsage = async (start: number, end: number, g: string, m: string, k: string) => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ range: 'custom', start: String(start), end: String(end) });
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

  const onRangeChange = (next: TimeRange) => {
    setTimeRange(next);
    void fetchUsage(next.start, next.end, granularity(), modelId(), keyId());
  };

  const applyGranularity = (g: 'hour' | 'day' | '') => {
    setGranularity(g);
    void fetchUsage(timeRange().start, timeRange().end, g, modelId(), keyId());
  };

  const applyFilters = () => {
    void fetchUsage(timeRange().start, timeRange().end, granularity(), modelId(), keyId());
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

  onMount(() => { const r = resolvePreset('1w'); void fetchUsage(r.start, r.end, '', '', ''); void fetchOptions(); });

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

  // SVG trend line — points are placed on a real time axis so uneven bucket
  // gaps don't distort the shape.
  const trendSvg = () => {
    const pts = trends();
    if (pts.length === 0) return null;
    const range = data()?.range;
    const start = range?.start ?? Math.min(...pts.map((p) => p.bucket));
    const end = range?.end ?? Math.max(...pts.map((p) => p.bucket));
    const span = Math.max(1, end - start);
    const max = Math.max(...pts.map((p) => p.requests), 1);
    const points = pts.map((p) => {
      const x = ((p.bucket - start) / span) * 100;
      const y = 100 - (p.requests / max) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return (
      <svg class="analytics-trend-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {[25, 50, 75].map((y) => (
          <line x1="0" y1={y} x2="100" y2={y} stroke="currentColor" stroke-opacity="0.12" stroke-width="0.5" />
        ))}
        <Show when={pts.length === 1}>
          <circle cx={points.split(',')[0]} cy={points.split(',')[1]} r="2.5" fill="currentColor" />
        </Show>
        <polyline points={points} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    );
  };

  // Token bar chart — input (solid) + output (light) stacked per bucket, with a
  // real time axis so uneven gaps don't distort the shape.
  const tokenBars = () => {
    const pts = trends();
    if (pts.length === 0) return null;
    const range = data()?.range;
    const start = range?.start ?? Math.min(...pts.map((p) => p.bucket));
    const end = range?.end ?? Math.max(...pts.map((p) => p.bucket));
    const span = Math.max(1, end - start);
    const max = Math.max(...pts.map((p) => p.input_tokens + p.output_tokens), 1);
    const step = (end - start) / Math.max(1, pts.length);
    const bars = pts.map((p) => {
      const center = ((p.bucket - start) / span) * 100;
      const width = Math.min(6, ((step / span) * 100) * 0.7);
      const x = Math.max(0, center - width / 2);
      const inputH = (p.input_tokens / max) * 100;
      const outputH = (p.output_tokens / max) * 100;
      return (
        <g>
          <title>{`${new Date(p.bucket * 1000).toLocaleString()} · ${t('usage.input')} ${p.input_tokens} / ${t('usage.output')} ${p.output_tokens}`}</title>
          <rect x={x.toFixed(2)} y={(100 - inputH - outputH).toFixed(2)} width={width.toFixed(2)} height={outputH.toFixed(2)} fill="currentColor" opacity="0.35" />
          <rect x={x.toFixed(2)} y={(100 - inputH).toFixed(2)} width={width.toFixed(2)} height={inputH.toFixed(2)} rx="1.5" fill="currentColor" opacity="0.9" />
        </g>
      );
    });
    return (
      <svg class="analytics-trend-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {[25, 50, 75].map((y) => (
          <line x1="0" y1={y} x2="100" y2={y} stroke="currentColor" stroke-opacity="0.12" stroke-width="0.5" />
        ))}
        {bars}
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
      </div>

      {/* Filters — time range picker sits in the same row as the other filters */}
      <div class="analytics-filters">
        <div class="analytics-filters-range">
          <TimeRangePicker value={timeRange()} onChange={onRangeChange} />
        </div>
        <label>{t('common.model')}
          <select value={modelId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setModelId(next);
            void fetchUsage(timeRange().start, timeRange().end, granularity(), next, keyId());
          }}>
            <option value="">{t('usage.allModels')}</option>
            <For each={modelOptions()}>{(m) => <option value={m.id}>{m.name}</option>}</For>
          </select>
        </label>
        <label>{t('common.key')}
          <select value={keyId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setKeyId(next);
            void fetchUsage(timeRange().start, timeRange().end, granularity(), modelId(), next);
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
          </div>
          <div class="analytics-metric-card">
            <small>{t('usage.avgLatency')}</small>
            <strong>{summary()?.avg_latency_ms != null ? `${summary()!.avg_latency_ms}ms` : '—'}</strong>
          </div>
          <div class="analytics-metric-card">
            <small>{t('usage.avgTtft')}</small>
            <strong>{summary()?.avg_ttft_ms != null ? `${summary()!.avg_ttft_ms}ms` : '—'}</strong>
          </div>
          <div class="analytics-metric-card">
            <small>{t('usage.successRate')}</small>
            <strong>{successRate() !== null ? `${successRate()}%` : '—'}</strong>
          </div>
        </div>

        {/* Request trend (line) + token consumption (bars) — side by side at 1:1 */}
        <div class="analytics-duo-grid" classList={{ 'analytics-duo-single': trends().length === 0 }}>
          <Show when={trends().length > 0}>
            <div class="panel analytics-trend-panel">
              <div class="panel-header"><h2>{t('usage.trends')}</h2><span class="analytics-hint">{t('usage.requestsChange')}</span></div>
              <div class="analytics-trend-chart">{trendSvg()}</div>
            </div>
          </Show>
          <div class="panel analytics-token-card">
            <div class="analytics-token-head">
              <div>
                <h3>{t('usage.tokenConsumption')}</h3>
                <div class="analytics-token-legend">
                  <i class="in" />{t('usage.input')}
                  <i class="out" />{t('usage.output')}
                </div>
              </div>
              <span class="analytics-token-total">{t('usage.totalTokens')} <strong>{fmtNum((summary()?.input_tokens ?? 0) + (summary()?.output_tokens ?? 0))}</strong></span>
            </div>
            <div class="analytics-token-chart">{tokenBars()}</div>
            <div class="analytics-token-row">
              <div><small>{t('usage.input')}</small><strong>{fmtNum(summary()?.input_tokens)}</strong></div>
              <div><small>{t('usage.output')}</small><strong>{fmtNum(summary()?.output_tokens)}</strong></div>
              <div><small>{t('usage.coverage')}</small><strong>{usageCoverage()}%</strong></div>
              <div><small>{t('usage.estCost')}</small><strong>{formatUsd(summary()?.cost_micros ?? 0)}</strong></div>
            </div>
          </div>
        </div>

        {/* Model table */}
        <Show when={models().length > 0}>
          <div class="panel analytics-model-panel">
            <div class="panel-header"><h2>{t('usage.modelsTable')}</h2><span class="analytics-hint">{t('usage.sortedByRequests')}</span></div>
            <div class="analytics-model-table">
              <div class="analytics-model-head">
                <span>{t('common.model')}</span><span>{t('usage.requests')}</span><span>{t('usage.successRate')}</span><span>{t('usage.avgTpm')}</span><span>{t('usage.avgLatency')}</span><span>{t('usage.avgTtft')}</span><span>{t('usage.tokensInOut')}</span><span>{t('usage.cost')}</span>
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
