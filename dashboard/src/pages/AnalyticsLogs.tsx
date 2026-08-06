import { createSignal, onMount, Show, For } from 'solid-js';
import { A } from '@solidjs/router';

interface LogRow {
  id: string;
  timestamp: number;
  request_id: string | null;
  key_id: string | null;
  key_name: string | null;
  unified_model_id: string | null;
  channel_name: string | null;
  channel_id: string | null;
  status: string;
  stream: number;
  cached: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  attempt_count: number;
  fallback: number;
  latency_ms: number;
  ttft_ms: number | null;
  requested_protocol: string | null;
  error_detail: string | null;
}

interface LogDetail {
  id: string;
  timestamp: number;
  request_id: string | null;
  key_name: string | null;
  unified_model_id: string | null;
  channel_name: string | null;
  status: string;
  stream: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  attempt_count: number;
  fallback: number;
  latency_ms: number;
  ttft_ms: number | null;
  requested_protocol: string | null;
  error_detail: string | null;
  context_request: string | null;
  context_response: string | null;
}

interface AnalyticsSettings {
  requestLogsEnabled: boolean;
  logSuccess: boolean;
  logErrors: boolean;
  logContext: boolean;
  contextRetentionHours: number;
  requestLogRetentionDays: number;
}

const STATUS_LABEL: Record<string, string> = {
  success: '成功', error: '失败', cancelled: '中断',
  rate_limited: '限流', budget_exceeded: '预算超限',
  not_allowed: '模型无权限', expired: '密钥过期',
};

const statusBadgeClass = (status: string) => status === 'success' ? 'badge active' : 'badge disabled';

function formatUsd(costMicros: number): string {
  if (costMicros === 0) return '—';
  return `$${(costMicros / 1_000_000).toFixed(4)}`;
}

export default function AnalyticsLogs() {
  const [logs, setLogs] = createSignal<LogRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [refreshing, setRefreshing] = createSignal(false);
  const [logsError, setLogsError] = createSignal('');
  const [settings, setSettings] = createSignal<AnalyticsSettings>({
    requestLogsEnabled: true, logSuccess: true, logErrors: true, logContext: false,
    contextRetentionHours: 24, requestLogRetentionDays: 7,
  });
  const [settingsBusy, setSettingsBusy] = createSignal(false);
  const [settingsError, setSettingsError] = createSignal('');
  const [showSettings, setShowSettings] = createSignal(false);

  // Filters
  const [status, setStatus] = createSignal('all');
  const [modelId, setModelId] = createSignal('');
  const [keyId, setKeyId] = createSignal('');
  const [channelId, setChannelId] = createSignal('');
  const [requestIdFilter, setRequestIdFilter] = createSignal('');
  const [startTime, setStartTime] = createSignal('');
  const [endTime, setEndTime] = createSignal('');
  const [limit, setLimit] = createSignal(50);
  const [clearBusy, setClearBusy] = createSignal(false);

  // Cursor pagination
  const [nextCursor, setNextCursor] = createSignal<{ timestamp: number; id: string } | null>(null);
  const [hasMore, setHasMore] = createSignal(false);

  // Detail drawer
  const [detail, setDetail] = createSignal<LogDetail | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);

  // Filter options
  const [modelOptions, setModelOptions] = createSignal<{ id: string; name: string }[]>([]);
  const [keyOptions, setKeyOptions] = createSignal<{ id: string; name: string }[]>([]);
  const [channelOptions, setChannelOptions] = createSignal<{ id: string; name: string }[]>([]);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/admin/api/analytics/settings');
      if (response.ok) setSettings(await response.json());
    } catch { /* non-critical */ }
  };

  const updateSettings = async (patch: Record<string, unknown>) => {
    setSettingsBusy(true);
    setSettingsError('');
    try {
      const response = await fetch('/admin/api/analytics/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (response.ok) {
        setSettings(await response.json());
      } else {
        const err = await response.json() as { error?: { message?: string } };
        setSettingsError(err?.error?.message ?? '保存失败');
      }
    } catch {
      setSettingsError('网络错误');
    } finally { setSettingsBusy(false); }
  };

  const fetchLogsDirect = async (reset: boolean, st: string, mId: string, kId: string, chId: string, rid: string, sTime: string, eTime: string, cursor: { timestamp: number; id: string } | null, pageSize = limit()) => {
    setRefreshing(true);
    setLogsError('');
    try {
      const query = new URLSearchParams({ limit: String(pageSize) });
      if (st !== 'all') query.set('status', st);
      if (mId) query.set('model_id', mId);
      if (kId) query.set('key_id', kId);
      if (chId) query.set('channel_id', chId);
      if (rid) query.set('request_id', rid);
      if (sTime) query.set('start', sTime);
      if (eTime) query.set('end', eTime);
      if (!reset && cursor) {
        query.set('cursor_ts', String(cursor.timestamp));
        query.set('cursor_id', cursor.id);
      }

      const response = await fetch(`/admin/api/analytics/logs?${query}`);
      if (!response.ok) throw new Error('请求日志加载失败');
      const data = await response.json() as { logs: LogRow[]; next_cursor: { timestamp: number; id: string } | null };
      if (reset) {
        setLogs(data.logs);
      } else {
        setLogs((prev) => [...prev, ...data.logs]);
      }
      setNextCursor(data.next_cursor);
      setHasMore(data.next_cursor !== null);
    } catch (cause) {
      setLogsError(cause instanceof Error ? cause.message : '请求日志加载失败');
    } finally { setRefreshing(false); setLoading(false); }
  };

  const applyFilters = () => {
    setNextCursor(null);
    setHasMore(false);
    void fetchLogsDirect(true, status(), modelId(), keyId(), channelId(), requestIdFilter(), startTime(), endTime(), null);
  };

  const loadMore = () => {
    void fetchLogsDirect(false, status(), modelId(), keyId(), channelId(), requestIdFilter(), startTime(), endTime(), nextCursor());
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(`/admin/api/analytics/logs/${id}`);
      if (response.ok) setDetail(await response.json());
    } finally { setDetailLoading(false); }
  };

  const closeDetail = () => setDetail(null);

  const clearAllLogs = async () => {
    if (!confirm('确认清空所有请求日志？此操作不可恢复，用量统计不受影响。')) return;
    setClearBusy(true);
    try {
      const response = await fetch('/admin/api/analytics/logs', { method: 'DELETE' });
      if (!response.ok) throw new Error('清空日志失败');
      setLogs([]);
      setNextCursor(null);
      setHasMore(false);
    } catch (cause) {
      setLogsError(cause instanceof Error ? cause.message : '清空日志失败');
    } finally { setClearBusy(false); }
  };

  const fetchFilterOptions = async () => {
    try {
      const [modelsRes, keysRes, channelsRes] = await Promise.all([
        fetch('/admin/api/models'),
        fetch('/admin/api/keys'),
        fetch('/admin/api/channels'),
      ]);
      if (modelsRes.ok) {
        const arr = (await modelsRes.json()) as Array<{ id: string; unified_model_id: string }>;
        setModelOptions(arr.map((m) => ({ id: m.unified_model_id, name: m.unified_model_id })));
      }
      if (keysRes.ok) {
        const arr = (await keysRes.json()) as Array<{ id: string; name: string }>;
        setKeyOptions(arr);
      }
      if (channelsRes.ok) {
        const arr = (await channelsRes.json()) as Array<{ id: string; name: string }>;
        setChannelOptions(arr);
      }
    } catch { /* non-critical */ }
  };

  onMount(() => {
    void fetchLogsDirect(true, 'all', '', '', '', '', '', '', null);
    void fetchSettings();
    void fetchFilterOptions();
  });

  const settingsOn = () => settings().requestLogsEnabled;
  const contextOn = () => settings().logContext;

  return (
    <div class="analytics-page">
      <div class="analytics-page-nav">
        <div class="analytics-segment-tabs">
          <A href="/analytics/usage" class="analytics-segment-tab">用量分析</A>
          <A href="/analytics/logs" class="analytics-segment-tab active">请求日志</A>
        </div>
        <div class="analytics-log-actions">
          <button class="ghost-button" onClick={() => setShowSettings(!showSettings())}>
            {showSettings() ? '收起设置' : '日志设置'}
          </button>
          <button class="ghost-button danger-link" disabled={clearBusy()} onClick={clearAllLogs}>
            {clearBusy() ? '清空中…' : '清空日志'}
          </button>
          <button class="primary-button" disabled={refreshing()} onClick={() => applyFilters()}>
            {refreshing() ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {/* Settings area */}
      <Show when={showSettings()}>
        <div class="panel analytics-settings">
          <div class="analytics-settings-grid">
            <label class="checkbox-label">
              <input type="checkbox" checked={settingsOn()} disabled={settingsBusy()}
                onChange={(e) => void updateSettings({ request_logs_enabled: e.currentTarget.checked })} />
              <span><strong>请求日志总开关</strong><small>关闭后不写 request_logs，不影响用量统计与预算</small></span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" checked={settings().logErrors} disabled={settingsBusy() || !settingsOn()}
                onChange={(e) => void updateSettings({ log_errors: e.currentTarget.checked })} />
              <span><strong>异常日志</strong><small>错误、中断、限流、预算和权限事件</small></span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" checked={settings().logSuccess} disabled={settingsBusy() || !settingsOn()}
                onChange={(e) => void updateSettings({ log_success: e.currentTarget.checked })} />
              <span><strong>正常日志</strong><small>成功请求明细</small></span>
            </label>
            <label class="checkbox-label context-warn">
              <input type="checkbox" checked={contextOn()} disabled={settingsBusy() || !settingsOn()}
                onChange={(e) => {
                  if (e.currentTarget.checked && !contextOn()) {
                    if (!confirm('开启上下文记录将保存请求和响应的前 4 KiB 预览，使用 AES-GCM 加密。\n\n确认开启？')) return;
                  }
                  void updateSettings({ log_context: e.currentTarget.checked });
                }} />
              <span><strong>记录上下文</strong><small>请求/响应前 4 KiB 预览 · 加密存储 · 隐私提示 · 不含 Header 或密钥</small></span>
            </label>
          </div>

          {/* Retention settings */}
          <div class="analytics-retention-row">
            <label>
              <span>日志保留天数</span>
              <select value={settings().requestLogRetentionDays} disabled={settingsBusy()}
                onChange={(e) => void updateSettings({ request_log_retention_days: Number(e.currentTarget.value) })}>
                <option value={1}>1 天</option>
                <option value={3}>3 天</option>
                <option value={7}>7 天</option>
              </select>
            </label>
            <label>
              <span>上下文保留小时</span>
              <input type="number" min={1} max={168} value={settings().contextRetentionHours} disabled={settingsBusy()}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (v >= 1 && v <= 168) void updateSettings({ context_retention_hours: v });
                }} />
            </label>
          </div>

          <Show when={settingsError()}>
            <div class="form-error">{settingsError()}</div>
          </Show>

          <div class="analytics-settings-footer">
            <small>关闭日志或级别开关只停止记录新明细，不影响已有数据；</small>
            <small>用量统计（Analytics）与密钥预算始终运行。</small>
          </div>
        </div>
      </Show>

      {/* Filters */}
      <div class="analytics-log-filters">
        <label>状态
          <select value={status()} onChange={(e) => {
            const next = e.currentTarget.value;
            setStatus(next);
            void fetchLogsDirect(true, next, modelId(), keyId(), channelId(), requestIdFilter(), startTime(), endTime(), null);
          }}>
            <option value="all">全部</option>
            <option value="success">成功</option>
            <option value="error">失败</option>
            <option value="cancelled">中断</option>
            <option value="rate_limited">限流</option>
            <option value="budget_exceeded">预算超限</option>
            <option value="not_allowed">无权限</option>
            <option value="expired">过期</option>
          </select>
        </label>
        <label class="filter-time"><span>时间范围</span>
          <div>
            <input type="text" placeholder="开始 Unix 秒" value={startTime()} onInput={(e) => setStartTime(e.currentTarget.value)} />
            <input type="text" placeholder="结束 Unix 秒" value={endTime()} onInput={(e) => setEndTime(e.currentTarget.value)} />
          </div>
        </label>
        <label>模型
          <select value={modelId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setModelId(next);
            void fetchLogsDirect(true, status(), next, keyId(), channelId(), requestIdFilter(), startTime(), endTime(), null);
          }}>
            <option value="">全部</option>
            <For each={modelOptions()}>{(m) => <option value={m.id}>{m.name}</option>}</For>
          </select>
        </label>
        <label>密钥
          <select value={keyId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setKeyId(next);
            void fetchLogsDirect(true, status(), modelId(), next, channelId(), requestIdFilter(), startTime(), endTime(), null);
          }}>
            <option value="">全部</option>
            <For each={keyOptions()}>{(k) => <option value={k.id}>{k.name}</option>}</For>
          </select>
        </label>
        <label>渠道
          <select value={channelId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setChannelId(next);
            void fetchLogsDirect(true, status(), modelId(), keyId(), next, requestIdFilter(), startTime(), endTime(), null);
          }}>
            <option value="">全部</option>
            <For each={channelOptions()}>{(c) => <option value={c.id}>{c.name}</option>}</For>
          </select>
        </label>
        <label class="filter-request-id">Request ID
          <input type="text" value={requestIdFilter()} placeholder="精确匹配..."
            onInput={(e) => setRequestIdFilter(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }} />
        </label>
        <label>每页
          <select value={String(limit())} onChange={(e) => {
            const next = Number(e.currentTarget.value);
            setLimit(next);
            void fetchLogsDirect(true, status(), modelId(), keyId(), channelId(), requestIdFilter(), startTime(), endTime(), null, next);
          }}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <button class="secondary-button" onClick={applyFilters}>查询</button>
      </div>

      <Show when={loading()}><div class="analytics-skeleton"><div class="skeleton-table" /></div></Show>

      <Show when={!loading() && logsError()}>
        <div class="panel analytics-error-state"><strong>无法加载请求日志</strong><span>{logsError()}</span><button class="secondary-button" onClick={applyFilters}>重试</button></div>
      </Show>

      <Show when={!loading() && !logsError() && logs().length === 0}>
        <div class="panel empty-state">
          <span class="provider-logo">L</span>
          <h3>暂无请求记录</h3>
          <p>发起网关调用后这里会显示最近请求。请检查日志总开关是否已开启。</p>
        </div>
      </Show>

      <Show when={!loading() && !logsError() && logs().length > 0}>
        <div class="panel analytics-log-panel">
          <div class="analytics-log-table">
            <div class="analytics-log-head">
              <span>请求 ID</span><span>时间</span><span>模型</span><span>渠道</span><span>密钥</span><span>Token</span><span>TTFT</span><span>延迟</span><span>状态</span><span>操作</span>
            </div>
            <For each={logs()}>{(log) => (
              <div class="analytics-log-row">
                <span class="alog-rid"><code title={log.request_id ?? ''}>{(log.request_id ?? '').slice(0, 12)}</code></span>
                <span class="alog-time">{new Date(log.timestamp * 1000).toLocaleString()}</span>
                <span class="alog-model"><code>{log.unified_model_id ?? '—'}</code></span>
                <span class="alog-channel">{log.channel_name ?? '—'}</span>
                <span class="alog-key">{log.key_name ?? '—'}</span>
                <span class="alog-tokens">{log.input_tokens.toLocaleString()} / {log.output_tokens.toLocaleString()}</span>
                <span class="alog-ttft">{log.ttft_ms != null ? `${log.ttft_ms}ms` : '—'}</span>
                <span class="alog-latency">{log.latency_ms}ms{log.fallback ? ' ⤵' : ''}</span>
                <span><span class={statusBadgeClass(log.status)}>{STATUS_LABEL[log.status] ?? log.status}</span></span>
                <span><button class="ghost-button" onClick={() => void openDetail(log.id)}>详情</button></span>
              </div>
            )}</For>
          </div>
          <Show when={hasMore()}>
            <div class="analytics-log-more">
              <button class="secondary-button" disabled={refreshing()} onClick={loadMore}>
                {refreshing() ? '加载中…' : '加载更多'}
              </button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Detail drawer */}
      <Show when={detail() || detailLoading()}>
        <div class="modal-backdrop" onClick={closeDetail}>
          <div class="modal-card analytics-detail-drawer" onClick={(e) => e.stopPropagation()}>
            <div class="modal-title">
              <div>
                <h3>请求详情</h3>
                <p>{(detail()?.request_id ?? '').slice(0, 36)}</p>
              </div>
              <button onClick={closeDetail}>✕</button>
            </div>
            <Show when={detailLoading()}><p class="empty-state">加载中…</p></Show>
            <Show when={detail()}>{(d) => (
              <div class="analytics-detail-grid">
                <DetailItem label="时间" value={new Date(d().timestamp * 1000).toLocaleString()} />
                <DetailItem label="状态" value={STATUS_LABEL[d().status] ?? d().status} />
                <DetailItem label="模型" value={d().unified_model_id ?? '—'} />
                <DetailItem label="渠道" value={d().channel_name ?? '—'} />
                <DetailItem label="密钥" value={d().key_name ?? '—'} />
                <DetailItem label="协议" value={d().requested_protocol ?? '—'} />
                <DetailItem label="流式" value={d().stream ? '是' : '否'} />
                <DetailItem label="Token (入/出)" value={`${d().input_tokens.toLocaleString()} / ${d().output_tokens.toLocaleString()}`} />
                <DetailItem label="费用" value={formatUsd(d().cost_micros)} />
                <DetailItem label="延迟" value={`${d().latency_ms}ms`} />
                <DetailItem label="TTFT" value={d().ttft_ms != null ? `${d().ttft_ms}ms` : '—'} />
                <DetailItem label="尝试次数" value={`${d().attempt_count}${d().fallback ? ' · 发生回退' : ''}`} />
                <Show when={d().error_detail}>
                  <div class="detail-wide">
                    <small>错误详情</small>
                    <pre class="analytics-error-detail">{d().error_detail}</pre>
                  </div>
                </Show>
                <div class="detail-wide">
                  <small>上下文</small>
                  <Show when={d().context_request || d().context_response} fallback={
                    <span class="analytics-no-context">未启用上下文记录</span>
                  }>
                    <Show when={d().context_request}>
                      <div class="context-block">
                        <strong>请求预览（前 4 KiB）</strong>
                        <pre>{d().context_request}</pre>
                      </div>
                    </Show>
                    <Show when={d().context_response}>
                      <div class="context-block">
                        <strong>响应预览（前 4 KiB）</strong>
                        <pre>{d().context_response}</pre>
                      </div>
                    </Show>
                  </Show>
                </div>
              </div>
            )}</Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <div class="detail-item">
      <small>{props.label}</small>
      <strong>{props.value}</strong>
    </div>
  );
}
