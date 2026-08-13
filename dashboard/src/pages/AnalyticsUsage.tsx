import { createSignal, onCleanup, onMount, Show, For, type JSX } from 'solid-js';
import { A } from '@solidjs/router';
import { locale, t } from '../i18n';
import TimeRangePicker, { resolvePreset, type TimeRange } from '../components/TimeRangePicker';

interface AnalyticsSummary {
  requests: number;
  successes: number;
  errors: number;
  cancelled: number;
  fallbacks: number;
  input_tokens: number;
  cache_input_tokens: number;
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
  cache_input_tokens: number;
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
  if (total === 0) return '-';
  return `${Math.round((part / total) * 100)}%`;
}

function niceAxisMax(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatAxisValue(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return Number(value.toFixed(value < 10 && value % 1 ? 1 : 0)).toLocaleString();
}

function formatAxisTime(timestamp: number, span: number): string {
  const date = new Date(timestamp * 1000);
  const language = locale() === 'zh' ? 'zh-CN' : 'en-US';
  if (span >= 172_800) return new Intl.DateTimeFormat(language, { month: 'numeric', day: 'numeric' }).format(date);
  if (span >= 7_200) return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

function ChartFrame(props: { max: number; start: number; end: number; unit: string; children: JSX.Element }) {
  const span = () => Math.max(1, props.end - props.start);
  const yTicks = () => [props.max, props.max * 0.75, props.max * 0.5, props.max * 0.25, 0];
  const xTicks = () => [props.start, props.start + span() / 2, props.end];
  return (
    <div class="analytics-chart-frame">
      <div class="analytics-axis-unit">{props.unit}</div>
      <div class="analytics-axis-y"><For each={yTicks()}>{(tick) => <span>{formatAxisValue(tick)}</span>}</For></div>
      <div class="analytics-chart-plot">{props.children}</div>
      <div class="analytics-axis-x"><For each={xTicks()}>{(tick) => <span>{formatAxisTime(tick, span())}</span>}</For></div>
    </div>
  );
}


export default function AnalyticsUsage() {
  const [data, setData] = createSignal<AnalyticsUsageResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [timeRange, setTimeRange] = createSignal<TimeRange>({ preset: '1w', ...resolvePreset('1w') });
  const [granularity, setGranularity] = createSignal<'hour' | 'day' | ''>('day');
  const [modelId, setModelId] = createSignal('');
  const [keyId, setKeyId] = createSignal('');
  const [modelOptions, setModelOptions] = createSignal<{ id: string; name: string }[]>([]);
  const [keyOptions, setKeyOptions] = createSignal<{ id: string; name: string }[]>([]);
  const [expandedChart, setExpandedChart] = createSignal<'requests' | 'tokens' | null>(null);

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

  onMount(() => { const r = resolvePreset('1w'); void fetchUsage(r.start, r.end, 'day', '', ''); void fetchOptions(); });
  onMount(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedChart(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    onCleanup(() => window.removeEventListener('keydown', closeOnEscape));
  });

  const summary = () => data()?.summary;
  const models = () => data()?.models ?? [];
  const trendStep = () => granularity() === 'day' ? 86_400 : granularity() === 'hour' ? 3_600 : 300;
  const trends = () => {
    const response = data();
    const raw = response?.trends ?? [];
    if (!response || raw.length === 0) return raw;
    const step = trendStep();
    const byBucket = new Map(raw.map((point) => [point.bucket, point]));
    const start = Math.floor(response.range.start / step) * step;
    const end = Math.floor(response.range.end / step) * step;
    const filled: AnalyticsTrendPoint[] = [];
    for (let bucket = start; bucket <= end && filled.length < 9001; bucket += step) {
      filled.push(byBucket.get(bucket) ?? { bucket, requests: 0, input_tokens: 0, cache_input_tokens: 0, output_tokens: 0, cost_micros: 0 });
    }
    return filled;
  };
  const chartTrends = () => {
    const points = trends();
    const maxVisibleBuckets = 48;
    if (points.length <= maxVisibleBuckets) return points;
    const groupSize = Math.ceil(points.length / maxVisibleBuckets);
    const grouped: AnalyticsTrendPoint[] = [];
    for (let index = 0; index < points.length; index += groupSize) {
      const group = points.slice(index, index + groupSize);
      grouped.push(group.reduce<AnalyticsTrendPoint>((total, point) => ({
        bucket: total.bucket,
        requests: total.requests + point.requests,
        input_tokens: total.input_tokens + point.input_tokens,
        cache_input_tokens: total.cache_input_tokens + point.cache_input_tokens,
        output_tokens: total.output_tokens + point.output_tokens,
        cost_micros: total.cost_micros + point.cost_micros,
      }), { bucket: group[0].bucket, requests: 0, input_tokens: 0, cache_input_tokens: 0, output_tokens: 0, cost_micros: 0 }));
    }
    return grouped;
  };

  const successRate = () => {
    const s = summary();
    if (!s || s.requests === 0) return null;
    return Math.round((s.successes / s.requests) * 100);
  };
  const cachedTokens = () => Math.min(summary()?.input_tokens ?? 0, summary()?.cache_input_tokens ?? 0);
  const uncachedInputTokens = () => Math.max(0, (summary()?.input_tokens ?? 0) - cachedTokens());
  const chartRange = () => {
    const range = data()?.range;
    const pts = trends();
    const step = trendStep();
    return {
      start: range ? Math.floor(range.start / step) * step : Math.min(...pts.map((p) => p.bucket)),
      end: range ? Math.floor(range.end / step) * step : Math.max(...pts.map((p) => p.bucket)),
    };
  };

  const trendSvg = () => {
    const pts = chartTrends();
    if (pts.length === 0) return null;
    const { start, end } = chartRange();
    const span = Math.max(1, end - start);
    const max = Math.max(4, niceAxisMax(Math.max(...pts.map((p) => p.requests), 1)));
    const baseline = 174;
    const chartHeight = 168;
    const points = pts.map((p) => {
      const x = ((p.bucket - start) / span) * 1000;
      const y = baseline - (p.requests / max) * chartHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return (
      <ChartFrame max={max} start={start} end={end} unit={t('usage.requestsUnit')}>
        <svg class="analytics-trend-svg" viewBox="0 0 1000 180" preserveAspectRatio="none" role="img" aria-label={t('usage.trends')}>
        {[6, 48, 90, 132, 174].map((y) => (
          <line x1="0" y1={y} x2="1000" y2={y} stroke="currentColor" stroke-opacity="0.1" stroke-width="1" vector-effect="non-scaling-stroke" />
        ))}
        <Show when={pts.length > 1}><polygon points={`${points} 1000,${baseline} 0,${baseline}`} fill="currentColor" opacity="0.055" /></Show>
        <polyline points={points} fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
        <For each={pts}>{(point, index) => {
          const previous = pts[Math.max(0, index() - 1)]?.bucket ?? start;
          const next = pts[Math.min(pts.length - 1, index() + 1)]?.bucket ?? end;
          const left = ((Math.max(start, (previous + point.bucket) / 2) - start) / span) * 1000;
          const right = ((Math.min(end, (next + point.bucket) / 2) - start) / span) * 1000;
          return <rect x={left} y="0" width={Math.max(2, right - left)} height="180" fill="transparent"><title>{`${new Date(point.bucket * 1000).toLocaleString()} | ${point.requests} ${t('usage.requestsUnit')}`}</title></rect>;
        }}</For>
        </svg>
      </ChartFrame>
    );
  };

  const tokenBars = () => {
    const pts = chartTrends();
    if (pts.length === 0) return null;
    const { start, end } = chartRange();
    const span = Math.max(1, end - start);
    const max = Math.max(4, niceAxisMax(Math.max(...pts.map((p) => p.input_tokens + p.output_tokens), 1)));
    const baseline = 174;
    const chartHeight = 168;
    const width = Math.min(72, Math.max(12, (1000 / Math.max(pts.length, 1)) * 0.62));
    const bars = pts.map((p) => {
      const center = ((p.bucket - start) / span) * 1000;
      const x = Math.min(1000 - width, Math.max(0, center - width / 2));
      const cached = Math.min(p.input_tokens, p.cache_input_tokens);
      const uncachedInput = Math.max(0, p.input_tokens - cached);
      const inputH = (uncachedInput / max) * chartHeight;
      const cacheH = (cached / max) * chartHeight;
      const outputH = (p.output_tokens / max) * chartHeight;
      return (
        <g>
          <title>{`${new Date(p.bucket * 1000).toLocaleString()} | ${t('usage.inputNonCached')} ${uncachedInput} / ${t('usage.cache')} ${cached} / ${t('usage.output')} ${p.output_tokens}`}</title>
          <rect class="token-bar-output" x={x} y={baseline - inputH - cacheH - outputH} width={width} height={outputH} rx="3" />
          <rect class="token-bar-cache" x={x} y={baseline - inputH - cacheH} width={width} height={cacheH} rx="3" />
          <rect class="token-bar-input" x={x} y={baseline - inputH} width={width} height={inputH} rx="3" />
        </g>
      );
    });
    return (
      <ChartFrame max={max} start={start} end={end} unit="Token">
        <svg class="analytics-trend-svg" viewBox="0 0 1000 180" preserveAspectRatio="none" role="img" aria-label={t('usage.tokenConsumption')}>
        {[6, 48, 90, 132, 174].map((y) => (
          <line x1="0" y1={y} x2="1000" y2={y} stroke="currentColor" stroke-opacity="0.1" stroke-width="1" vector-effect="non-scaling-stroke" />
        ))}
        {bars}
        </svg>
      </ChartFrame>
    );
  };

  const openChartWithKeyboard = (event: KeyboardEvent, chart: 'requests' | 'tokens') => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setExpandedChart(chart);
    }
  };

  return (
    <div class="analytics-page">
      <div class="analytics-page-nav">
        <div class="analytics-segment-tabs">
          <A href="/analytics/usage" class="analytics-segment-tab active">{t('nav.analyticsUsage')}</A>
          <A href="/analytics/logs" class="analytics-segment-tab">{t('nav.analyticsLogs')}</A>
        </div>
      </div>

      {/* Time range and dimensions share one compact filter row. */}
      <div class="analytics-filters">
        <div class="analytics-filters-range">
          <TimeRangePicker value={timeRange()} onChange={onRangeChange} />
        </div>
        <label class="analytics-filter-field"><span class="sr-only">{t('common.model')}</span>
          <select aria-label={t('common.model')} value={modelId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setModelId(next);
            void fetchUsage(timeRange().start, timeRange().end, granularity(), next, keyId());
          }}>
            <option value="">{t('usage.allModels')}</option>
            <For each={modelOptions()}>{(m) => <option value={m.id}>{m.name}</option>}</For>
          </select>
        </label>
        <label class="analytics-filter-field"><span class="sr-only">{t('common.key')}</span>
          <select aria-label={t('common.key')} value={keyId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setKeyId(next);
            void fetchUsage(timeRange().start, timeRange().end, granularity(), modelId(), next);
          }}>
            <option value="">{t('usage.allKeys')}</option>
            <For each={keyOptions()}>{(k) => <option value={k.id}>{k.name}</option>}</For>
          </select>
        </label>
        <label class="analytics-filter-field"><span class="sr-only">{t('usage.granularity')}</span>
          <select aria-label={t('usage.granularity')} value={granularity()} onChange={(e) => applyGranularity(e.currentTarget.value as 'hour' | 'day' | '')}>
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
        {/* QwenCloud-style metric cards: requests / request duration / TTFT / success / cache hit rate */}
        <div class="analytics-metrics-grid">
          <div class="analytics-metric-card">
            <small>{t('usage.requests')}</small>
            <strong>{fmtNum(summary()?.requests)}</strong>
          </div>
          <div class="analytics-metric-card">
            <small>{t('usage.avgLatency')}</small>
            <strong>{summary()?.avg_latency_ms != null ? `${summary()!.avg_latency_ms}ms` : '-'}</strong>
          </div>
          <div class="analytics-metric-card">
            <small title={t('usage.ttftStreamingOnly')}>{t('usage.avgTtft')}</small>
            <strong>{summary()?.avg_ttft_ms != null ? `${summary()!.avg_ttft_ms}ms` : '—'}</strong>
            <p>{t('usage.ttftStreamingOnly')}</p>
          </div>
          <div class="analytics-metric-card">
            <small>{t('usage.successRate')}</small>
            <strong>{successRate() !== null ? `${successRate()}%` : '-'}</strong>
          </div>
          <div class="analytics-metric-card">
            <small>{t('usage.avgCacheHitRate')}</small>
            <strong>{pct(cachedTokens(), summary()?.input_tokens ?? 0)}</strong>
            <p>{t('usage.cacheHitRateHint')}</p>
          </div>
        </div>

        {/* Equal-width overview cards stack on narrow screens and expand on demand. */}
        <div class="analytics-duo-grid">
          <section class="panel analytics-trend-panel analytics-chart-card" role="button" tabIndex={0} aria-label={`${t('usage.trends')} · ${t('usage.expandChart')}`} onClick={() => setExpandedChart('requests')} onKeyDown={(event) => openChartWithKeyboard(event, 'requests')}>
            <div class="panel-header"><h2>{t('usage.trends')}</h2><span class="analytics-chart-unit">{t('usage.unitRequests')}</span></div>
            <div class="analytics-trend-chart"><Show when={trends().length > 0} fallback={<div class="analytics-empty-chart">{t('usage.noTrendData')}</div>}>{trendSvg()}</Show></div>
          </section>
          <section class="panel analytics-token-card analytics-chart-card" role="button" tabIndex={0} aria-label={`${t('usage.tokenConsumption')} · ${t('usage.expandChart')}`} onClick={() => setExpandedChart('tokens')} onKeyDown={(event) => openChartWithKeyboard(event, 'tokens')}>
            <div class="analytics-token-head">
              <div>
                <h3>{t('usage.tokenConsumption')}</h3>
                <div class="analytics-token-legend">
                  <i class="input" />{t('usage.inputNonCached')}
                  <i class="cache" />{t('usage.cache')}
                  <i class="output" />{t('usage.output')}
                </div>
              </div>
              <div class="analytics-token-meta"><span class="analytics-token-total">{t('usage.totalTokens')} <strong>{fmtNum((summary()?.input_tokens ?? 0) + (summary()?.output_tokens ?? 0))}</strong></span></div>
            </div>
            <div class="analytics-token-chart"><Show when={trends().length > 0} fallback={<div class="analytics-empty-chart">{t('usage.noTrendData')}</div>}>{tokenBars()}</Show></div>
            <div class="analytics-token-row">
              <div><small>{t('usage.inputNonCached')}</small><strong>{fmtNum(uncachedInputTokens())}</strong></div>
              <div><small>{t('usage.cache')}</small><strong>{fmtNum(cachedTokens())}</strong></div>
              <div><small>{t('usage.output')}</small><strong>{fmtNum(summary()?.output_tokens)}</strong></div>
              <div><small>{t('usage.estCost')}</small><strong>{formatUsd(summary()?.cost_micros ?? 0)}</strong></div>
            </div>
          </section>
        </div>

        <Show when={expandedChart()}>{(chart) => (
          <div class="modal-backdrop analytics-chart-backdrop" onClick={() => setExpandedChart(null)}>
            <section class="panel analytics-chart-modal" role="dialog" aria-modal="true" aria-label={chart() === 'requests' ? t('usage.trends') : t('usage.tokenConsumption')} onClick={(event) => event.stopPropagation()}>
              <div class="analytics-chart-modal-head">
                <div>
                  <h2>{chart() === 'requests' ? t('usage.trends') : t('usage.tokenConsumption')}</h2>
                  <Show when={chart() === 'tokens'}>
                    <div class="analytics-token-legend">
                      <i class="input" />{t('usage.inputNonCached')}
                      <i class="cache" />{t('usage.cache')}
                      <i class="output" />{t('usage.output')}
                    </div>
                  </Show>
                </div>
                <button type="button" class="analytics-chart-close" aria-label={t('usage.closeChart')} onClick={() => setExpandedChart(null)}>×</button>
              </div>
              <div class={chart() === 'requests' ? 'analytics-trend-chart' : 'analytics-token-chart'}>
                <Show when={trends().length > 0} fallback={<div class="analytics-empty-chart">{t('usage.noTrendData')}</div>}>
                  {chart() === 'requests' ? trendSvg() : tokenBars()}
                </Show>
              </div>
            </section>
          </div>
        )}</Show>

        {/* Model table */}
        <Show when={models().length > 0}>
          <div class="panel analytics-model-panel">
            <div class="panel-header"><h2>{t('usage.modelsTable')}</h2><span class="analytics-hint">{t('usage.sortedByRequests')}</span></div>
            <div class="analytics-model-table">
              <div class="analytics-model-head">
                <span>{t('common.model')}</span><span>{t('usage.requests')}</span><span>{t('usage.successRate')}</span><span>{t('usage.avgTpm')}</span><span>{t('usage.avgLatency')}</span><span title={t('usage.ttftStreamingOnly')}>{t('usage.avgTtft')}</span><span>{t('usage.tokensSplit')}</span><span>{t('usage.cacheHitRate')}</span><span>{t('usage.cost')}</span>
              </div>
              <For each={models()}>{(model) => (
                <div class="analytics-model-row">
                  <span class="amodel-name" data-label={t('common.model')}><code>{model.unified_model_id}</code></span>
                  <span data-label={t('usage.requests')}>{fmtNum(model.requests)}</span>
                  <span data-label={t('usage.successRate')}>{pct(model.successes, model.requests)}</span>
                  <span class="amodel-muted" data-label={t('usage.avgTpm')}>{model.requests > 0 ? fmtNum(Math.round(model.input_tokens / model.requests)) : '-'}</span>
                  <span class="amodel-muted" data-label={t('usage.avgLatency')}>{model.avg_latency_ms != null ? `${model.avg_latency_ms}ms` : '-'}</span>
                  <span class="amodel-muted" data-label={`${t('usage.avgTtft')} (${t('usage.ttftStreamingOnly')})`}>{model.avg_ttft_ms != null ? `${model.avg_ttft_ms}ms` : '—'}</span>
                  <span class="amodel-tokens" data-label={t('usage.tokensSplit')}>{fmtNum(Math.max(0, model.input_tokens - Math.min(model.input_tokens, model.cache_input_tokens)))} / {fmtNum(Math.min(model.input_tokens, model.cache_input_tokens))} / {fmtNum(model.output_tokens)}</span>
                  <span data-label={t('usage.cacheHitRate')}>{pct(model.cache_input_tokens, model.input_tokens)}</span>
                  <span class="amodel-cost" data-label={t('usage.cost')}>{formatUsd(model.cost_micros)}</span>
                </div>
              )}</For>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}
