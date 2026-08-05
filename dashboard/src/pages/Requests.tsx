import { createSignal, onMount, Show, For } from 'solid-js';

interface RequestLog {
  id: string;
  timestamp: number;
  request_id: string | null;
  key_id: string | null;
  key_name: string | null;
  unified_model_id: string | null;
  channel_name: string | null;
  status: string;
  stream: number;
  cached: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  attempt_count: number;
  fallback: number;
  latency_ms: number;
}

const STATUS_LABEL: Record<string, string> = {
  success: '成功', error: '失败', cancelled: '中断',
  rate_limited: '限流', budget_exceeded: '预算超限',
  not_allowed: '模型无权限', expired: '密钥过期',
};

const statusClass = (status: string) => status === 'success' ? 'badge active' : 'badge disabled';

function formatUsd(costMicros: number): string {
  if (costMicros === 0) return '—';
  return `$${(costMicros / 1_000_000).toFixed(4)}`;
}

export default function Requests() {
  const [logs, setLogs] = createSignal<RequestLog[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [status, setStatus] = createSignal('all');
  const [limit, setLimit] = createSignal(50);
  const [refreshing, setRefreshing] = createSignal(false);

  const fetchLogs = async () => {
    setRefreshing(true);
    try {
      const query = new URLSearchParams({ limit: String(limit()) });
      if (status() !== 'all') query.set('status', status());
      const response = await fetch(`/admin/api/requests?${query}`);
      if (response.ok) {
        const data = await response.json() as { logs: RequestLog[] };
        setLogs(data.logs);
      }
    } finally { setRefreshing(false); setLoading(false); }
  };

  onMount(() => { void fetchLogs(); setInterval(() => void fetchLogs(), 15_000); });

  return (
    <div class="resource-page">
      <div class="page-heading">
        <div><h2>请求日志</h2><p>最近请求的密钥、模型、渠道、用量与费用（保留 7 天）。</p></div>
        <button class="primary-button" disabled={refreshing()} onClick={() => fetchLogs()}>
          {refreshing() ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div class="requests-toolbar">
        <label>状态
          <select value={status()} onChange={(e) => { setStatus(e.currentTarget.value); void fetchLogs(); }}>
            <option value="all">全部</option>
            <option value="success">成功</option>
            <option value="error">失败</option>
            <option value="cancelled">中断</option>
            <option value="rate_limited">限流</option>
            <option value="budget_exceeded">预算超限</option>
            <option value="not_allowed">模型无权限</option>
            <option value="expired">密钥过期</option>
          </select>
        </label>
        <label>条数
          <select value={String(limit())} onChange={(e) => { setLimit(Number(e.currentTarget.value)); void fetchLogs(); }}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
        </label>
        <span class="requests-count">共 {logs().length} 条 · 每 15 秒自动刷新</span>
      </div>

      {loading() && <p class="empty-state">Loading...</p>}
      <Show when={!loading() && logs().length === 0}><div class="panel empty-state"><span class="provider-logo">R</span><h3>暂无请求记录</h3><p>发起网关调用后，这里会显示最近请求。</p></div></Show>

      <Show when={!loading() && logs().length > 0}>
        <div class="panel request-log-panel">
          <div class="request-log-table">
            <div class="request-log-head">
              <span>时间</span><span>密钥</span><span>模型</span><span>渠道</span><span>状态</span><span>Token (入/出)</span><span>费用</span><span>耗时</span>
            </div>
            <For each={logs()}>{(log) => (
              <div class="request-log-row">
                <span class="req-time">{new Date(log.timestamp * 1000).toLocaleString()}</span>
                <span class="req-key">{log.key_name ?? '—'}</span>
                <span class="req-model"><code>{log.unified_model_id ?? '—'}</code>{log.cached ? ' · 缓存' : ''}</span>
                <span class="req-channel">{log.channel_name ?? '—'}</span>
                <span><span class={statusClass(log.status)}>{STATUS_LABEL[log.status] ?? log.status}</span></span>
                <span class="req-tokens">{log.input_tokens.toLocaleString()} / {log.output_tokens.toLocaleString()}</span>
                <span class="req-cost">{formatUsd(log.cost_micros)}</span>
                <span class="req-latency">{log.latency_ms}ms{log.fallback ? ' · 回退' : ''}{log.attempt_count > 1 ? ` · ${log.attempt_count}次` : ''}</span>
              </div>
            )}</For>
          </div>
        </div>
      </Show>
    </div>
  );
}
