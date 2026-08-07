import { createSignal, onMount, Show, For } from 'solid-js';
import { A } from '@solidjs/router';
import { t } from '../i18n';
import TimeRangePicker, { resolvePreset, type TimeRange } from '../components/TimeRangePicker';

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

const statusLabel = (status: string): string => ({
  success: t('status.success'), error: t('status.error'), cancelled: t('status.cancelled'),
  rate_limited: t('status.rateLimited'), budget_exceeded: t('status.budgetExceeded'),
  not_allowed: t('status.notAllowed'), expired: t('status.expired'),
}[status] ?? status);

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
  const [timeRange, setTimeRange] = createSignal<TimeRange>({ preset: '1w', ...resolvePreset('1w') });
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
        setSettingsError(err?.error?.message ?? t('keys.saveFailed'));
      }
    } catch {
      setSettingsError(t('common.networkError'));
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
      if (!response.ok) throw new Error(t('logs.loadFailed'));
      const data = await response.json() as { logs: LogRow[]; next_cursor: { timestamp: number; id: string } | null };
      if (reset) {
        setLogs(data.logs);
      } else {
        setLogs((prev) => [...prev, ...data.logs]);
      }
      setNextCursor(data.next_cursor);
      setHasMore(data.next_cursor !== null);
    } catch (cause) {
      setLogsError(cause instanceof Error ? cause.message : t('logs.loadFailed'));
    } finally { setRefreshing(false); setLoading(false); }
  };

  const applyFilters = () => {
    setNextCursor(null);
    setHasMore(false);
    void fetchLogsDirect(true, status(), modelId(), keyId(), channelId(), requestIdFilter(), String(timeRange().start), String(timeRange().end), null);
  };

  const loadMore = () => {
    void fetchLogsDirect(false, status(), modelId(), keyId(), channelId(), requestIdFilter(), String(timeRange().start), String(timeRange().end), nextCursor());
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

  const exportCsv = async () => {
    try {
      const query = new URLSearchParams({ export: '1', limit: '10000' });
      if (status() !== 'all') query.set('status', status());
      if (modelId()) query.set('model_id', modelId());
      if (keyId()) query.set('key_id', keyId());
      if (channelId()) query.set('channel_id', channelId());
      if (requestIdFilter()) query.set('request_id', requestIdFilter());
      query.set('start', String(timeRange().start));
      query.set('end', String(timeRange().end));
      const response = await fetch(`/admin/api/analytics/logs?${query}`);
      if (!response.ok) throw new Error(t('logs.exportFailed'));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mygateway-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setLogsError(cause instanceof Error ? cause.message : t('logs.exportFailed'));
    }
  };

  const clearAllLogs = async () => {
    if (!confirm(t('logs.clearConfirm'))) return;
    setClearBusy(true);
    try {
      const response = await fetch('/admin/api/analytics/logs', { method: 'DELETE' });
      if (!response.ok) throw new Error(t('logs.clearFailed'));
      setLogs([]);
      setNextCursor(null);
      setHasMore(false);
    } catch (cause) {
      setLogsError(cause instanceof Error ? cause.message : t('logs.clearFailed'));
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
          <A href="/analytics/usage" class="analytics-segment-tab">{t('nav.analyticsUsage')}</A>
          <A href="/analytics/logs" class="analytics-segment-tab active">{t('nav.analyticsLogs')}</A>
        </div>
        <div class="analytics-log-actions">
          <button class="ghost-button" onClick={() => setShowSettings(!showSettings())}>
            {showSettings() ? t('logs.hideSettings') : t('logs.settings')}
          </button>
          <button class="ghost-button" onClick={exportCsv}>
            {t('logs.export')}
          </button>
          <button class="ghost-button danger-link" disabled={clearBusy()} onClick={clearAllLogs}>
            {clearBusy() ? t('logs.clearing') : t('logs.clear')}
          </button>
          <button class="primary-button" disabled={refreshing()} onClick={() => applyFilters()}>
            {refreshing() ? t('common.refreshing') : t('common.refresh')}
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
              <span><strong>{t('logs.master')}</strong><small>{t('logs.masterHint')}</small></span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" checked={settings().logErrors} disabled={settingsBusy() || !settingsOn()}
                onChange={(e) => void updateSettings({ log_errors: e.currentTarget.checked })} />
              <span><strong>{t('logs.errors')}</strong><small>{t('logs.errorsHint')}</small></span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" checked={settings().logSuccess} disabled={settingsBusy() || !settingsOn()}
                onChange={(e) => void updateSettings({ log_success: e.currentTarget.checked })} />
              <span><strong>{t('logs.success')}</strong><small>{t('logs.successHint')}</small></span>
            </label>
            <label class="checkbox-label context-warn">
              <input type="checkbox" checked={contextOn()} disabled={settingsBusy() || !settingsOn()}
                onChange={(e) => {
                  if (e.currentTarget.checked && !contextOn()) {
                    if (!confirm(t('logs.contextConfirm'))) return;
                  }
                  void updateSettings({ log_context: e.currentTarget.checked });
                }} />
              <span><strong>{t('logs.context')}</strong><small>{t('logs.contextHint')}</small></span>
            </label>
          </div>

          {/* Retention settings */}
          <div class="analytics-retention-row">
            <label>
              <span>{t('logs.logRetention')}</span>
              <select value={settings().requestLogRetentionDays} disabled={settingsBusy()}
                onChange={(e) => void updateSettings({ request_log_retention_days: Number(e.currentTarget.value) })}>
                <option value={1}>1 {t('usage.days')}</option>
                <option value={3}>3 {t('usage.days')}</option>
                <option value={7}>7 {t('usage.days')}</option>
              </select>
            </label>
            <label>
              <span>{t('logs.contextRetention')}</span>
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
            <small>{t('logs.settingsFooter1')}</small>
            <small>{t('logs.settingsFooter2')}</small>
          </div>
        </div>
      </Show>

      {/* Filters */}
      <div class="analytics-log-filters">
        <label>{t('common.status')}
          <select value={status()} onChange={(e) => {
            const next = e.currentTarget.value;
            setStatus(next);
            void fetchLogsDirect(true, next, modelId(), keyId(), channelId(), requestIdFilter(), String(timeRange().start), String(timeRange().end), null);
          }}>
            <option value="all">{t('common.all')}</option>
            <option value="success">{t('status.success')}</option>
            <option value="error">{t('status.error')}</option>
            <option value="cancelled">{t('status.cancelled')}</option>
            <option value="rate_limited">{t('status.rateLimited')}</option>
            <option value="budget_exceeded">{t('status.budgetExceeded')}</option>
            <option value="not_allowed">{t('status.notAllowed')}</option>
            <option value="expired">{t('status.expired')}</option>
          </select>
        </label>
        <div class="logs-range-picker">
          <TimeRangePicker
            value={timeRange()}
            onChange={(next) => {
              setTimeRange(next);
              void fetchLogsDirect(true, status(), modelId(), keyId(), channelId(), requestIdFilter(), String(next.start), String(next.end), null);
            }}
          />
        </div>
        <label>{t('common.model')}
          <select value={modelId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setModelId(next);
            void fetchLogsDirect(true, status(), next, keyId(), channelId(), requestIdFilter(), String(timeRange().start), String(timeRange().end), null);
          }}>
            <option value="">{t('common.all')}</option>
            <For each={modelOptions()}>{(m) => <option value={m.id}>{m.name}</option>}</For>
          </select>
        </label>
        <label>{t('common.key')}
          <select value={keyId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setKeyId(next);
            void fetchLogsDirect(true, status(), modelId(), next, channelId(), requestIdFilter(), String(timeRange().start), String(timeRange().end), null);
          }}>
            <option value="">{t('common.all')}</option>
            <For each={keyOptions()}>{(k) => <option value={k.id}>{k.name}</option>}</For>
          </select>
        </label>
        <label>{t('common.channel')}
          <select value={channelId()} onChange={(e) => {
            const next = e.currentTarget.value;
            setChannelId(next);
            void fetchLogsDirect(true, status(), modelId(), keyId(), next, requestIdFilter(), String(timeRange().start), String(timeRange().end), null);
          }}>
            <option value="">{t('common.all')}</option>
            <For each={channelOptions()}>{(c) => <option value={c.id}>{c.name}</option>}</For>
          </select>
        </label>
        <label class="filter-request-id">Request ID
          <input type="text" value={requestIdFilter()} placeholder="…"
            onInput={(e) => setRequestIdFilter(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }} />
        </label>
        <label>{t('logs.perPage')}
          <select value={String(limit())} onChange={(e) => {
            const next = Number(e.currentTarget.value);
            setLimit(next);
            void fetchLogsDirect(true, status(), modelId(), keyId(), channelId(), requestIdFilter(), String(timeRange().start), String(timeRange().end), null, next);
          }}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <button class="secondary-button" onClick={applyFilters}>{t('logs.query')}</button>
      </div>

      <Show when={loading()}><div class="analytics-skeleton"><div class="skeleton-table" /></div></Show>

      <Show when={!loading() && logsError()}>
        <div class="panel analytics-error-state"><strong>{t('logs.loadFailed')}</strong><span>{logsError()}</span><button class="secondary-button" onClick={applyFilters}>{t('common.retry')}</button></div>
      </Show>

      <Show when={!loading() && !logsError()}>
        <div class="panel analytics-log-panel">
          <div class="analytics-log-table">
            <div class="analytics-log-head">
              <span>{t('logs.requestId')}</span><span>{t('logs.timestamp')}</span><span>{t('common.model')}</span><span>{t('logs.source')}</span><span>{t('logs.apiKey')}</span><span>{t('logs.usage')}</span><span>TTFT</span><span>{t('logs.latency')}</span><span>{t('common.status')}</span><span>{t('logs.actions')}</span>
            </div>
            <Show when={logs().length === 0} fallback={<For each={logs()}>{(log) => (
              <div class="analytics-log-row">
                <span class="alog-rid"><code title={log.request_id ?? ''}>{(log.request_id ?? '').slice(0, 12)}</code></span>
                <span class="alog-time">{new Date(log.timestamp * 1000).toLocaleString()}</span>
                <span class="alog-model"><code>{log.unified_model_id ?? '—'}</code></span>
                <span class="alog-channel">{log.channel_name ?? '—'}</span>
                <span class="alog-key">{log.key_name ?? '—'}</span>
                <span class="alog-tokens">{log.input_tokens.toLocaleString()} / {log.output_tokens.toLocaleString()}</span>
                <span class="alog-ttft">{log.ttft_ms != null ? `${log.ttft_ms}ms` : '—'}</span>
                <span class="alog-latency">{log.latency_ms}ms{log.fallback ? ' ⤵' : ''}</span>
                <span><span class={statusBadgeClass(log.status)}>{statusLabel(log.status)}</span></span>
                <span><button class="ghost-button" onClick={() => void openDetail(log.id)}>{t('logs.detail')}</button></span>
              </div>
            )}</For>}>
              <div class="analytics-log-row analytics-log-empty">
                <span class="alog-empty-span" style="grid-column: 1 / -1">
                  <strong>{t('logs.noLogs')}</strong>
                  <span>{t('logs.noLogsBody')}</span>
                </span>
              </div>
            </Show>
          </div>
          <Show when={hasMore()}>
            <div class="analytics-log-more">
              <button class="secondary-button" disabled={refreshing()} onClick={loadMore}>
                {refreshing() ? t('common.loading') : t('logs.loadMore')}
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
                <h3>{t('logs.detailTitle')}</h3>
                <p>{(detail()?.request_id ?? '').slice(0, 36)}</p>
              </div>
              <button onClick={closeDetail}>✕</button>
            </div>
            <Show when={detailLoading()}><p class="empty-state">{t('common.loading')}</p></Show>
            <Show when={detail()}>{(d) => (
              <div class="analytics-detail-grid">
                <DetailItem label={t('common.time')} value={new Date(d().timestamp * 1000).toLocaleString()} />
                <DetailItem label={t('common.status')} value={statusLabel(d().status)} />
                <DetailItem label={t('common.model')} value={d().unified_model_id ?? '—'} />
                <DetailItem label={t('common.channel')} value={d().channel_name ?? '—'} />
                <DetailItem label={t('common.key')} value={d().key_name ?? '—'} />
                <DetailItem label={t('logs.protocol')} value={d().requested_protocol ?? '—'} />
                <DetailItem label={t('logs.streaming')} value={d().stream ? '✓' : '—'} />
                <DetailItem label={t('logs.tokens')} value={`${d().input_tokens.toLocaleString()} / ${d().output_tokens.toLocaleString()}`} />
                <DetailItem label={t('logs.spend')} value={formatUsd(d().cost_micros)} />
                <DetailItem label={t('logs.latency')} value={`${d().latency_ms}ms`} />
                <DetailItem label={t('logs.ttft')} value={d().ttft_ms != null ? `${d().ttft_ms}ms` : '—'} />
                <DetailItem label={t('logs.attempts')} value={`${d().attempt_count}${d().fallback ? ` · ${t('logs.fallback')}` : ''}`} />
                <Show when={d().error_detail}>
                  <div class="detail-wide">
                    <small>{t('logs.errorDetail')}</small>
                    <pre class="analytics-error-detail">{d().error_detail}</pre>
                  </div>
                </Show>
                <div class="detail-wide">
                  <small>{t('logs.context')}</small>
                  <Show when={d().context_request || d().context_response} fallback={
                    <span class="analytics-no-context">{t('logs.noContext')}</span>
                  }>
                    <Show when={d().context_request}>
                      <div class="context-block">
                        <strong>{t('logs.requestPreview')}</strong>
                        <pre>{d().context_request}</pre>
                      </div>
                    </Show>
                    <Show when={d().context_response}>
                      <div class="context-block">
                        <strong>{t('logs.responsePreview')}</strong>
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
