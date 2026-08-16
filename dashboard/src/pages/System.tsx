import { createSignal, onCleanup, onMount, Show, For } from 'solid-js';
import { A } from '@solidjs/router';
import { useAuth } from '../index';
import { t } from '../i18n';
import { useAppDialog } from '../components/AppDialog';

interface ModelPriceRow {
  provider_model_id: string;
  display_name: string;
  provider: string;
  input_price_micros_per_million: number;
  output_price_micros_per_million: number;
  cache_input_price_micros_per_million: number | null;
  currency: string;
}

interface PriceDraft {
  input: string; output: string; cache: string; currency: 'USD' | 'CNY';
}

interface AnalyticsSettings {
  requestLogsEnabled: boolean;
  logSuccess: boolean;
  logErrors: boolean;
  logContext: boolean;
  contextRetentionHours: number;
  requestLogRetentionDays: number;
}

interface ManagementKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  permission: 'read' | 'write';
  status: 'active' | 'disabled';
  expires_at: number | null;
  last_used_at: number | null;
}

interface RevealedManagementKey {
  id: string;
  key: string;
  expires_at: number | null;
  show_until: number;
}

const MANAGEMENT_KEY_STORAGE = 'mygateway.management-key.reveal.v1';

function readRevealedManagementKey(): RevealedManagementKey | null {
  try {
    const value = JSON.parse(localStorage.getItem(MANAGEMENT_KEY_STORAGE) ?? 'null') as RevealedManagementKey | null;
    if (!value || !value.key?.startsWith('mgmt_') || value.show_until <= Date.now() || (value.expires_at !== null && value.expires_at * 1000 <= Date.now())) {
      localStorage.removeItem(MANAGEMENT_KEY_STORAGE);
      return null;
    }
    return value;
  } catch {
    localStorage.removeItem(MANAGEMENT_KEY_STORAGE);
    return null;
  }
}

const fmt = (v: number | null) => (v === null || v === 0 ? '' : String(v / 1_000_000));
const toMicros = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) : 0;
};

export default function System() {
  const dialog = useAppDialog();
  const auth = useAuth();
  const [status, setStatus] = createSignal<{ version: string; status: string } | null>(null);
  const [prices, setPrices] = createSignal<ModelPriceRow[]>([]);
  const [drafts, setDrafts] = createSignal<Record<string, PriceDraft>>({});
  const [pricesBusy, setPricesBusy] = createSignal(false);
  const [pricesError, setPricesError] = createSignal('');
  const [newModelId, setNewModelId] = createSignal('');
  const [saved, setSaved] = createSignal(false);
  const [priceExpanded, setPriceExpanded] = createSignal(false);
  const [settings, setSettings] = createSignal<AnalyticsSettings>({
    requestLogsEnabled: true, logSuccess: true, logErrors: true, logContext: false,
    contextRetentionHours: 24, requestLogRetentionDays: 7,
  });
  const [settingsDraft, setSettingsDraft] = createSignal<AnalyticsSettings>({
    requestLogsEnabled: true, logSuccess: true, logErrors: true, logContext: false,
    contextRetentionHours: 24, requestLogRetentionDays: 7,
  });
  const [settingsBusy, setSettingsBusy] = createSignal(false);
  const [settingsError, setSettingsError] = createSignal('');
  const [settingsSaved, setSettingsSaved] = createSignal(false);
  const [clearLogsBusy, setClearLogsBusy] = createSignal(false);
  const [clearLogsResult, setClearLogsResult] = createSignal<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [publicUrl, setPublicUrl] = createSignal(location.origin);
  const [savedPublicUrl, setSavedPublicUrl] = createSignal('');
  const [publicUrlBusy, setPublicUrlBusy] = createSignal(false);
  const [publicUrlError, setPublicUrlError] = createSignal('');
  const [publicUrlSaved, setPublicUrlSaved] = createSignal(false);
  const [managementKeys, setManagementKeys] = createSignal<ManagementKeyRow[]>([]);
  const [managementName, setManagementName] = createSignal('Agent automation');
  const [managementPermission, setManagementPermission] = createSignal<'read' | 'write'>('write');
  const [managementExpiry, setManagementExpiry] = createSignal('7');
  const [managementCreateOpen, setManagementCreateOpen] = createSignal(false);
  const [managementExpanded, setManagementExpanded] = createSignal(false);
  const [managementBusy, setManagementBusy] = createSignal(false);
  const [managementError, setManagementError] = createSignal('');
  const [revealedManagementKey, setRevealedManagementKey] = createSignal<RevealedManagementKey | null>(null);
  const [copied, setCopied] = createSignal(false);

  const settingsDirty = () => JSON.stringify(settingsDraft()) !== JSON.stringify(settings());
  const patchDraft = (patch: Partial<AnalyticsSettings>) => {
    setSettingsDraft((d) => ({ ...d, ...patch }));
    setSettingsSaved(false);
  };

  onMount(async () => {
    setRevealedManagementKey(readRevealedManagementKey());
    try {
      const response = await fetch('/admin/api/system/status');
      if (response.ok) setStatus(await response.json());
    } catch {}
    await loadPrices();
    await fetchSettings();
    await loadManagementKeys();
    await loadPublicUrl();
  });

  const revealTimer = window.setInterval(() => {
    const value = revealedManagementKey();
    if (value && (value.show_until <= Date.now() || (value.expires_at !== null && value.expires_at * 1000 <= Date.now()))) {
      localStorage.removeItem(MANAGEMENT_KEY_STORAGE);
      setRevealedManagementKey(null);
    }
  }, 15_000);
  onCleanup(() => window.clearInterval(revealTimer));

  const loadManagementKeys = async () => {
    try {
      const response = await fetch('/admin/api/management-keys');
      if (response.ok) {
        const rows = await response.json() as ManagementKeyRow[];
        setManagementKeys(rows);
        const revealed = revealedManagementKey();
        if (revealed && !rows.some((row) => row.id === revealed.id)) {
          localStorage.removeItem(MANAGEMENT_KEY_STORAGE);
          setRevealedManagementKey(null);
        }
      }
    } catch { /* non-critical */ }
  };

  const rememberManagementKey = (row: ManagementKeyRow & { key: string }) => {
    const value: RevealedManagementKey = {
      id: row.id,
      key: row.key,
      expires_at: row.expires_at,
      show_until: row.expires_at === null
        ? Date.now() + 3_600_000
        : Math.min(Date.now() + 3_600_000, row.expires_at * 1000),
    };
    localStorage.setItem(MANAGEMENT_KEY_STORAGE, JSON.stringify(value));
    setRevealedManagementKey(value);
  };

  const createManagementKey = async () => {
    setManagementBusy(true); setManagementError(''); setCopied(false);
    try {
      const response = await fetch('/admin/api/management-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: managementName().trim(), permission: managementPermission(),
          expires_at: managementExpiry() === 'permanent'
            ? null
            : Math.floor(Date.now() / 1000) + Number(managementExpiry()) * 86_400,
        }),
      });
      const body = await response.json() as ManagementKeyRow & { key?: string; error?: { message?: string } };
      if (!response.ok || !body.key) throw new Error(body.error?.message ?? t('management.createFailed'));
      rememberManagementKey(body as ManagementKeyRow & { key: string });
      setManagementCreateOpen(false);
      await loadManagementKeys();
    } catch (cause) {
      setManagementError(cause instanceof Error ? cause.message : t('management.createFailed'));
    } finally { setManagementBusy(false); }
  };

  const updateManagementKeyStatus = async (row: ManagementKeyRow) => {
    setManagementBusy(true); setManagementError('');
    try {
      const response = await fetch(`/admin/api/management-keys/${encodeURIComponent(row.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: row.status === 'active' ? 'disabled' : 'active' }),
      });
      if (!response.ok) throw new Error(t('management.updateFailed'));
      await loadManagementKeys();
    } catch (cause) { setManagementError(cause instanceof Error ? cause.message : t('management.updateFailed')); }
    finally { setManagementBusy(false); }
  };

  const deleteManagementKey = async (row: ManagementKeyRow) => {
    if (!await dialog.confirm({ title: t('management.delete'), message: t('management.deleteConfirm'), danger: true })) return;
    setManagementBusy(true); setManagementError('');
    try {
      const response = await fetch(`/admin/api/management-keys/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(t('management.updateFailed'));
      if (revealedManagementKey()?.id === row.id) {
        localStorage.removeItem(MANAGEMENT_KEY_STORAGE); setRevealedManagementKey(null);
      }
      await loadManagementKeys();
    } catch (cause) { setManagementError(cause instanceof Error ? cause.message : t('management.updateFailed')); }
    finally { setManagementBusy(false); }
  };

  const loadPublicUrl = async () => {
    try {
      const response = await fetch('/admin/api/system/public-url');
      if (!response.ok) return;
      const body = await response.json() as { public_url: string | null };
      const configured = body.public_url ?? '';
      setSavedPublicUrl(configured);
      setPublicUrl(configured || location.origin);
    } catch { /* current origin remains the safe default */ }
  };

  const savePublicUrl = async () => {
    setPublicUrlBusy(true); setPublicUrlError(''); setPublicUrlSaved(false);
    try {
      const response = await fetch('/admin/api/system/public-url', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_url: publicUrl().trim() }),
      });
      const body = await response.json() as { public_url?: string; error?: { message?: string } };
      if (!response.ok || !body.public_url) throw new Error(body.error?.message ?? t('system.publicUrlSaveFailed'));
      setPublicUrl(body.public_url); setSavedPublicUrl(body.public_url); setPublicUrlSaved(true);
    } catch (cause) {
      setPublicUrlError(cause instanceof Error ? cause.message : t('system.publicUrlSaveFailed'));
    } finally { setPublicUrlBusy(false); }
  };

  const effectivePublicUrl = () => savedPublicUrl() || location.origin;

  const agentPrompt = () => {
    const revealed = revealedManagementKey();
    return `Install the mygateway-admin skill from ${effectivePublicUrl()}/skill.md using your platform's skill installation method, then follow its instructions to manage MyGateway.\nMYGATEWAY_URL=${effectivePublicUrl()}\nMYGATEWAY_MANAGEMENT_KEY=${revealed?.key ?? 'mgmt_YOUR_MANAGEMENT_KEY'}`;
  };

  const copyAgentPrompt = async () => {
    await navigator.clipboard.writeText(agentPrompt());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const formatTimestamp = (value: number | null) => value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value * 1000)
    : t('management.never');
  const formatExpiry = (value: number | null) => value === null ? t('management.permanent') : formatTimestamp(value);
  const visibleManagementKeys = () => managementExpanded() ? managementKeys() : managementKeys().slice(0, 3);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/admin/api/analytics/settings');
      if (response.ok) {
        const next = await response.json() as AnalyticsSettings;
        setSettings(next);
        setSettingsDraft(next);
      }
    } catch { /* non-critical */ }
  };

  const saveSettings = async () => {
    setSettingsBusy(true);
    setSettingsError('');
    setSettingsSaved(false);
    try {
      const response = await fetch('/admin/api/analytics/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_logs_enabled: settingsDraft().requestLogsEnabled,
          log_errors: settingsDraft().logErrors,
          log_success: settingsDraft().logSuccess,
          log_context: settingsDraft().logContext,
          context_retention_hours: settingsDraft().contextRetentionHours,
          request_log_retention_days: settingsDraft().requestLogRetentionDays,
        }),
      });
      if (response.ok) {
        const next = await response.json() as AnalyticsSettings;
        setSettings(next);
        setSettingsDraft(next);
        setSettingsSaved(true);
      } else {
        const err = await response.json() as { error?: { message?: string } };
        setSettingsError(err?.error?.message ?? t('keys.saveFailed'));
      }
    } catch {
      setSettingsError(t('common.networkError'));
    } finally { setSettingsBusy(false); }
  };

  const draftOn = () => settingsDraft().requestLogsEnabled;
  const draftContextOn = () => settingsDraft().logContext;

  const clearAllLogs = async () => {
    if (!await dialog.confirm({ title: t('logs.clearAll'), message: t('logs.clearConfirm'), danger: true })) return;
    setClearLogsBusy(true); setClearLogsResult(null);
    try {
      const response = await fetch('/admin/api/analytics/logs', { method: 'DELETE' });
      if (!response.ok) throw new Error(t('logs.clearFailed'));
      const result = await response.json() as { deleted?: number };
      setClearLogsResult({ kind: 'success', text: t('logs.cleared').replace('{count}', String(result.deleted ?? 0)) });
    } catch (cause) {
      setClearLogsResult({ kind: 'error', text: cause instanceof Error ? cause.message : t('logs.clearFailed') });
    } finally { setClearLogsBusy(false); }
  };

  const loadPrices = async () => {
    try {
      const response = await fetch('/admin/api/model-prices');
      if (response.ok) {
        const data = await response.json() as { prices: ModelPriceRow[] };
        setPrices(data.prices);
        const d: Record<string, PriceDraft> = {};
        for (const p of data.prices) {
          d[p.provider_model_id] = {
            input: fmt(p.input_price_micros_per_million),
            output: fmt(p.output_price_micros_per_million),
            cache: fmt(p.cache_input_price_micros_per_million),
            currency: p.currency === 'CNY' ? 'CNY' : 'USD',
          };
        }
        setDrafts(d);
      }
    } catch {}
  };

  const savePrices = async () => {
    setPricesBusy(true); setPricesError(''); setSaved(false);
    try {
      const response = await fetch('/admin/api/model-prices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prices: Object.entries(drafts()).map(([id, d]) => ({
            provider_model_id: id,
            display_name: prices().find((p) => p.provider_model_id === id)?.display_name ?? id,
            provider: prices().find((p) => p.provider_model_id === id)?.provider ?? 'custom',
            input_price_micros_per_million: toMicros(d.input),
            output_price_micros_per_million: toMicros(d.output),
            cache_input_price_micros_per_million: d.cache.trim() ? toMicros(d.cache) : null,
            currency: d.currency,
          })),
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        setPricesError(err?.error?.message ?? t('keys.saveFailed'));
        return;
      }
      setSaved(true);
      await loadPrices();
    } finally { setPricesBusy(false); }
  };

  const addPrice = async () => {
    const id = newModelId().trim();
    if (!id) return;
    setPrices((cur) => [...cur, {
      provider_model_id: id, display_name: id, provider: 'custom',
      input_price_micros_per_million: 0, output_price_micros_per_million: 0,
      cache_input_price_micros_per_million: null, currency: 'USD',
    }]);
    setDrafts((cur) => ({ ...cur, [id]: { input: '', output: '', cache: '', currency: 'USD' } }));
    setNewModelId('');
  };

  const removePrice = async (id: string) => {
    const existed = prices().some((p) => p.provider_model_id === id);
    setPrices((cur) => cur.filter((p) => p.provider_model_id !== id));
    setDrafts((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
    if (!existed) return; // never saved — nothing to remove server-side
    setPricesBusy(true); setPricesError('');
    try {
      const response = await fetch(`/admin/api/model-prices/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const err = await response.json();
        setPricesError(err?.error?.message ?? t('keys.saveFailed'));
        await loadPrices(); // restore the row so nothing is lost silently
      }
    } catch {
      setPricesError(t('common.networkError'));
      await loadPrices();
    } finally { setPricesBusy(false); }
  };

  return (
    <div class="settings-grid">
      <section class="panel settings-card account-settings-card">
        <div class="settings-icon violet">A</div>
        <div class="settings-copy"><span class="eyebrow">{t('system.eyebrowAccount')}</span><h2>{t('system.account')}</h2><p>{t('system.accountBody')}：<strong>{auth.username()}</strong>。</p></div>
        <A href="/change-password" class="secondary-button">{t('system.changeCredentials')}</A>
      </section>

      <section class="panel settings-card public-url-card">
        <div class="settings-icon green">URL</div>
        <div class="settings-copy">
          <span class="eyebrow">{t('system.eyebrowAccess')}</span>
          <h2>{t('system.publicUrl')}</h2>
          <p>{t('system.publicUrlBody')}</p>
          <label class="public-url-field"><span>{t('system.publicUrlLabel')}</span><input type="url" value={publicUrl()} placeholder="https://gateway.example.com" onInput={(event) => { setPublicUrl(event.currentTarget.value); setPublicUrlSaved(false); setPublicUrlError(''); }} /></label>
          <div class="public-url-detected"><span>{t('system.detectedUrl')} <code>{location.origin}</code></span><button type="button" onClick={() => { setPublicUrl(location.origin); setPublicUrlSaved(false); setPublicUrlError(''); }}>{t('system.useDetectedUrl')}</button></div>
          <Show when={publicUrlError()}><div class="form-error">{publicUrlError()}</div></Show>
          <div class="public-url-actions"><Show when={publicUrlSaved()}><span class="price-saved" role="status">{t('common.saved')}</span></Show><button class="primary-button" disabled={publicUrlBusy() || !publicUrl().trim() || publicUrl() === savedPublicUrl()} onClick={savePublicUrl}>{publicUrlBusy() ? t('common.saving') : t('common.save')}</button></div>
        </div>
      </section>

      <section class="panel settings-card wide management-card">
        <div class="management-heading-row">
          <div class="settings-copy management-heading">
            <span class="eyebrow">{t('management.eyebrow')}</span>
            <h2>{t('management.title')}</h2>
            <p>{t('management.body')}</p>
          </div>
          <Show when={!managementCreateOpen()}><button class="primary-button" onClick={() => setManagementCreateOpen(true)}>{t('management.create')}</button></Show>
        </div>
        <Show when={managementCreateOpen()}><div class="management-create-panel">
          <div class="management-create">
            <label><span>{t('management.name')}</span><input value={managementName()} onInput={(event) => setManagementName(event.currentTarget.value)} /></label>
            <label><span>{t('management.permission')}</span><select value={managementPermission()} onChange={(event) => setManagementPermission(event.currentTarget.value as 'read' | 'write')}><option value="read">{t('management.read')}</option><option value="write">{t('management.write')}</option></select></label>
            <label><span>{t('management.expiry')}</span><select value={managementExpiry()} onChange={(event) => setManagementExpiry(event.currentTarget.value)}><option value="1">1 {t('usage.days')}</option><option value="7">7 {t('usage.days')}</option><option value="30">30 {t('usage.days')}</option><option value="90">90 {t('usage.days')}</option><option value="permanent">{t('management.permanent')}</option></select></label>
          </div>
          <div class="management-create-actions"><button class="ghost-button" disabled={managementBusy()} onClick={() => setManagementCreateOpen(false)}>{t('common.cancel')}</button><button class="primary-button" disabled={managementBusy() || !managementName().trim()} onClick={createManagementKey}>{managementBusy() ? t('common.saving') : t('management.create')}</button></div>
        </div></Show>
        <Show when={managementError()}><div class="form-error">{managementError()}</div></Show>
        <div class="management-reveal" classList={{ active: Boolean(revealedManagementKey()) }}>
            <div><strong>{t('management.agentPrompt')}</strong><small>{revealedManagementKey() ? t('management.revealHint') : t('management.defaultPromptHint')}</small></div>
            <pre>{agentPrompt()}</pre>
            <button class="secondary-button" onClick={copyAgentPrompt}>{copied() ? t('management.copied') : t('management.copyPrompt')}</button>
        </div>
        <div class="management-list">
          <For each={visibleManagementKeys()} fallback={<div class="management-empty">{t('management.empty')}</div>}>{(row) => (
            <article class="management-key-row">
              <div class="management-key-main"><strong>{row.name}</strong><code>{row.key_prefix}••••••••</code></div>
              <div><small>{t('management.permission')}</small><span>{row.permission === 'write' ? t('management.write') : t('management.read')}</span></div>
              <div><small>{t('management.expiry')}</small><span>{formatExpiry(row.expires_at)}</span></div>
              <div><small>{t('management.lastUsed')}</small><span>{formatTimestamp(row.last_used_at)}</span></div>
              <span class={`management-status ${row.status}`}><i aria-hidden="true" />{row.status === 'active' ? t('common.active') : t('common.disabled')}</span>
              <div class="management-actions"><button class="ghost-button" disabled={managementBusy()} onClick={() => updateManagementKeyStatus(row)}>{row.status === 'active' ? t('management.disable') : t('management.enable')}</button><button class="danger-button" disabled={managementBusy()} onClick={() => deleteManagementKey(row)}>{t('management.delete')}</button></div>
            </article>
          )}</For>
        </div>
        <Show when={managementKeys().length > 3}><button class="management-list-toggle" onClick={() => setManagementExpanded(!managementExpanded())}>{managementExpanded() ? t('management.collapse') : t('management.showAll').replace('{count}', String(managementKeys().length))}</button></Show>
      </section>

      <section class="panel settings-card wide log-settings-card">
        <div class="settings-copy">
          <span class="eyebrow">{t('system.eyebrowLogging')}</span>
          <h2>{t('logs.title')}</h2>
          <p>{t('logs.masterHint')}</p>
        </div>
        <div class="analytics-settings-grid">
          <label class="checkbox-label">
            <input type="checkbox" checked={draftOn()}
              onChange={(e) => patchDraft({ requestLogsEnabled: e.currentTarget.checked })} />
            <span><strong>{t('logs.master')}</strong><small>{t('logs.masterHint')}</small></span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" checked={settingsDraft().logErrors}
              onChange={(e) => patchDraft({ logErrors: e.currentTarget.checked })} />
            <span><strong>{t('logs.errors')}</strong><small>{t('logs.errorsHint')}</small></span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" checked={settingsDraft().logSuccess}
              onChange={(e) => patchDraft({ logSuccess: e.currentTarget.checked })} />
            <span><strong>{t('logs.success')}</strong><small>{t('logs.successHint')}</small></span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" checked={draftContextOn()}
              onChange={async (e) => {
                const next = e.currentTarget.checked;
                if (next && !draftContextOn() && !await dialog.confirm({ title: t('logs.contextTitle'), message: t('logs.contextConfirm'), danger: true })) {
                  e.currentTarget.checked = false;
                  return;
                }
                patchDraft({ logContext: next });
              }} />
            <span><strong>{t('logs.recordContext')}</strong><small>{t('logs.contextHint')}</small></span>
          </label>
        </div>

        <div class="analytics-retention-row">
          <label>
            <span>{t('logs.logRetention')}</span>
            <select value={settingsDraft().requestLogRetentionDays}
              onChange={(e) => patchDraft({ requestLogRetentionDays: Number(e.currentTarget.value) })}>
              <option value={1}>1 {t('usage.days')}</option>
              <option value={3}>3 {t('usage.days')}</option>
              <option value={7}>7 {t('usage.days')}</option>
            </select>
          </label>
          <label>
            <span>{t('logs.contextRetention')}</span>
            <input type="number" min={1} max={168} value={settingsDraft().contextRetentionHours}
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                if (v >= 1 && v <= 168) patchDraft({ contextRetentionHours: v });
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

        <div class="analytics-settings-actions">
          <Show when={settingsSaved()}><span class="price-saved">{t('common.saved')}</span></Show>
          <button class="primary-button" disabled={!settingsDirty() || settingsBusy()} onClick={saveSettings}>
            {settingsBusy() ? t('common.saving') : t('common.save')}
          </button>
        </div>
        <div class="log-maintenance-row"><div><strong>{t('logs.maintenance')}</strong><small>{t('logs.clearHint')}</small><Show when={clearLogsResult()}>{(result) => <span role="status" class={result().kind}>{result().text}</span>}</Show></div><button class="danger-button" disabled={clearLogsBusy()} onClick={clearAllLogs}>{clearLogsBusy() ? t('logs.clearing') : t('logs.clear')}</button></div>
      </section>

      <section class="panel settings-card wide price-library-card">
        <div class="price-library-toggle-row">
          <div class="settings-copy">
            <span class="eyebrow">{t('system.eyebrowPricing')}</span>
            <h2>{t('prices.libraryTitle')}</h2>
            <p>{t('prices.libraryHint')}</p>
          </div>
          <button class="secondary-button price-library-toggle" onClick={() => setPriceExpanded(!priceExpanded())}>
            <span class={`price-chevron${priceExpanded() ? ' open' : ''}`}>▸</span>
            {priceExpanded() ? t('prices.collapse') : t('prices.configure')}
            <Show when={!priceExpanded()}><small class="price-count">{prices().length} {t('prices.models')}</small></Show>
          </button>
        </div>
        <Show when={priceExpanded()}>
          <div class="price-library">
          <div class="price-library-row price-library-head">
            <span>{t('common.model')}</span><span>{t('prices.inputShort')}</span><span>{t('prices.outputShort')}</span><span>{t('prices.cacheShort')}</span><span>{t('prices.currencyShort')}</span><span />
          </div>
          <For each={prices()}>{(row) => {
            const draft = () => drafts()[row.provider_model_id] ?? { input: '', output: '', cache: '', currency: 'USD' as const };
            return (
              <div class="price-library-row">
                <span class="price-library-model"><strong>{row.display_name}</strong><code>{row.provider_model_id}</code></span>
                <input type="number" min="0" step="0.000001" value={draft().input} onInput={(e) => setDrafts((cur) => ({ ...cur, [row.provider_model_id]: { ...draft(), input: e.currentTarget.value } }))} />
                <input type="number" min="0" step="0.000001" value={draft().output} onInput={(e) => setDrafts((cur) => ({ ...cur, [row.provider_model_id]: { ...draft(), output: e.currentTarget.value } }))} />
                <input type="number" min="0" step="0.000001" value={draft().cache} onInput={(e) => setDrafts((cur) => ({ ...cur, [row.provider_model_id]: { ...draft(), cache: e.currentTarget.value } }))} />
                <select value={draft().currency} onChange={(e) => setDrafts((cur) => ({ ...cur, [row.provider_model_id]: { ...draft(), currency: e.currentTarget.value as 'USD' | 'CNY' } }))}>
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                </select>
                <button class="price-library-remove" title={t('common.delete')} onClick={() => removePrice(row.provider_model_id)}>×</button>
              </div>
            );
          }}</For>
          <div class="price-library-add">
            <input placeholder="provider-model-id" value={newModelId()} onInput={(e) => setNewModelId(e.currentTarget.value)} />
            <button class="secondary-button" onClick={addPrice}>+</button>
          </div>
          <Show when={pricesError()}><div class="form-error">{pricesError()}</div></Show>
          <div class="price-library-actions">
            <Show when={saved()}><span class="price-saved">{t('prices.saved')}</span></Show>
            <button class="primary-button" disabled={pricesBusy()} onClick={savePrices}>
              {pricesBusy() ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
        </Show>
      </section>

      <section class="panel settings-card wide system-note-card">
        <div class="settings-icon info">i</div>
        <div class="settings-copy">
          <span class="eyebrow">{t('system.eyebrowAbout')}</span>
          <h2>{t('system.about')}</h2>
          <div class="system-about-notes">
            <p>{t('system.securityBody')}</p>
            <p>{t('system.deploymentNote')}</p>
          </div>
          <div class="system-note-meta">
            <span class="system-version"><strong>{t('system.version')}</strong>v{status()?.version ?? '--'}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
