import { createSignal, onMount, Show, For, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';

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

const RANGE_LABELS: Record<string, string> = { today: '今日', '7d': '过去 7 天', '30d': '过去 30 天' };

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
      if (!response.ok) throw new Error('用量数据加载失败');
      setData(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '用量数据加载失败');
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
          <A href="/analytics/usage" class="analytics-segment-tab active">用量分析</A>
          <A href="/analytics/logs" class="analytics-segment-tab">请求日志</A>
        </div>
        <div class="analytics-range-tabs">
          <For each={['today', '7d', '30d'] as const}>{(item) => (
            <button classList={{ active: range() === item }} onClick={() => applyRange(item)}>
              {RANGE_LABELS[item]}
            </button>
          )}</For>
        </div>
      </div>

      <div class="analytics-filters">
        <label>模型
          <select value={modelId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setModelId(next);
            void fetchUsage(range(), granularity(), next, keyId());
          }}>
            <option value="">全部模型</option>
            <For each={modelOptions()}>{(m) => <option value={m.id}>{m.name}</option>}</For>
          </select>
        </label>
        <label>密钥
          <select value={keyId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setKeyId(next);
            void fetchUsage(range(), granularity(), modelId(), next);
          }}>
            <option value="">全部密钥</option>
            <For each={keyOptions()}>{(k) => <option value={k.id}>{k.name}</option>}</For>
          </select>
        </label>
        <label>趋势粒度
          <select value={granularity()} onChange={(e) => applyGranularity(e.currentTarget.value as 'hour' | 'day' | '')}>
            <option value="">5 分钟</option>
            <option value="hour">按小时</option>
            <option value="day">按天</option>
          </select>
        </label>
      </div>

      <Show when={loading()}><div class="analytics-skeleton"><div class="skeleton-cards"><span /><span /><span /><span /><span /></div><div class="skeleton-table" /></div></Show>

      <Show when={!loading() && error()}>
        <div class="panel analytics-error-state"><strong>无法加载用量分析</strong><span>{error()}</span><button class="secondary-button" onClick={applyFilters}>重试</button></div>
      </Show>

      <Show when={!loading() && !error() && data()}>
        {/* Metric cards: left high Token + cost, right 2x2 */}
        <div class="analytics-card-layout">
          <div class="analytics-metric-card analytics-token-highlight">
            <small>总 Token</small>
            <strong>{fmtNum((summary()?.input_tokens ?? 0) + (summary()?.output_tokens ?? 0))}</strong>
            <div class="analytics-token-breakdown">
              <span>入 {fmtNum(summary()?.input_tokens)}</span>
              <span>出 {fmtNum(summary()?.output_tokens)}</span>
            </div>
            <Show when={(summary()?.usage_unknown ?? 0) > 0}>
              <span class="coverage-warn">覆盖率 {usageCoverage()}%</span>
            </Show>
            <div class="analytics-cost-row">
              <small>预估费用</small>
              <strong>{formatUsd(summary()?.cost_micros ?? 0)}</strong>
            </div>
          </div>
          <div class="analytics-right-grid">
            <div class="analytics-metric-card">
              <small>请求量</small>
              <strong>{fmtNum(summary()?.requests)}</strong>
              <span>{successRate() !== null ? `成功率 ${successRate()}%` : '—'}</span>
            </div>
            <div class="analytics-metric-card">
              <small>平均延迟</small>
              <strong>{summary()?.avg_latency_ms != null ? `${summary()!.avg_latency_ms}ms` : '—'}</strong>
              <span>{summary()?.latency_count ?? 0} 次采样</span>
            </div>
            <div class="analytics-metric-card">
              <small>平均 TTFT</small>
              <strong>{summary()?.avg_ttft_ms != null ? `${summary()!.avg_ttft_ms}ms` : '—'}</strong>
              <span>仅流式 · {summary()?.ttft_count ?? 0} 次采样</span>
            </div>
            <div class="analytics-metric-card">
              <small>成功率</small>
              <strong>{successRate() !== null ? `${successRate()}%` : '—'}</strong>
              <span>错误 {fmtNum(summary()?.errors)} · 回退 {fmtNum(summary()?.fallbacks)}</span>
            </div>
          </div>
        </div>

        {/* Trend sparkline */}
        <Show when={trends().length > 0}>
          <div class="panel analytics-trend-panel">
            <div class="panel-header"><h2>请求趋势</h2><span class="analytics-hint">请求量变化</span></div>
            <div class="analytics-trend-chart">{trendSvg()}</div>
          </div>
        </Show>

        {/* Model table */}
        <Show when={models().length > 0}>
          <div class="panel analytics-model-panel">
            <div class="panel-header"><h2>模型明细</h2><span class="analytics-hint">按请求量排序</span></div>
            <div class="analytics-model-table">
              <div class="analytics-model-head">
                <span>模型</span><span>请求</span><span>成功率</span><span>平均 TPM</span><span>平均延迟</span><span>平均 TTFT</span><span>Token (入/出)</span><span>费用</span>
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
            <h3>暂无用量数据</h3>
            <p>发起网关调用后，这里会显示聚合用量统计。</p>
          </div>
        </Show>
      </Show>
    </div>
  );
}
