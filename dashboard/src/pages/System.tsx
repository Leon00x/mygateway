import { createSignal, onMount, Show, For } from 'solid-js';
import { A } from '@solidjs/router';
import { useAuth } from '../index';
import { t } from '../i18n';

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

const fmt = (v: number | null) => (v === null || v === 0 ? '' : String(v / 1_000_000));
const toMicros = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) : 0;
};

export default function System() {
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

  const settingsDirty = () => JSON.stringify(settingsDraft()) !== JSON.stringify(settings());
  const patchDraft = (patch: Partial<AnalyticsSettings>) => {
    setSettingsDraft((d) => ({ ...d, ...patch }));
    setSettingsSaved(false);
  };

  onMount(async () => {
    try {
      const response = await fetch('/admin/api/system/status');
      if (response.ok) setStatus(await response.json());
    } catch {}
    await loadPrices();
    await fetchSettings();
  });

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
      <section class="panel settings-card wide">
        <div class="settings-icon violet">A</div>
        <div class="settings-copy"><span class="eyebrow">{t('system.eyebrowAccount')}</span><h2>{t('system.account')}</h2><p>{t('system.accountBody')}：<strong>{auth.username()}</strong>。</p></div>
        <A href="/change-password" class="secondary-button">{t('system.changeCredentials')}</A>
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
              onChange={(e) => {
                const next = e.currentTarget.checked;
                if (next && !draftContextOn() && !confirm(t('logs.contextConfirm'))) {
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
                <input type="number" min="0" step="0.01" value={draft().input} onInput={(e) => setDrafts((cur) => ({ ...cur, [row.provider_model_id]: { ...draft(), input: e.currentTarget.value } }))} />
                <input type="number" min="0" step="0.01" value={draft().output} onInput={(e) => setDrafts((cur) => ({ ...cur, [row.provider_model_id]: { ...draft(), output: e.currentTarget.value } }))} />
                <input type="number" min="0" step="0.01" value={draft().cache} onInput={(e) => setDrafts((cur) => ({ ...cur, [row.provider_model_id]: { ...draft(), cache: e.currentTarget.value } }))} />
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
          <p>{t('system.securityBody')}</p>
          <div class="system-note-meta">
            <span class="system-version"><strong>{t('system.version')}</strong>v{status()?.version ?? '—'}</span>
            <a href="https://dash.cloudflare.com" target="_blank" class="ghost-button">{t('system.cloudflare')}</a>
          </div>
        </div>
      </section>
    </div>
  );
}
