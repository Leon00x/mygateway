import { createSignal, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { useAuth } from '../index';
import { t } from '../i18n';

export default function System() {
  const auth = useAuth();
  const [status, setStatus] = createSignal<{ version: string; status: string } | null>(null);
  onMount(async () => { try { const response = await fetch('/admin/api/system/status'); if (response.ok) setStatus(await response.json()); } catch {} });

  return (
    <div class="settings-grid">
      <section class="panel settings-card">
        <div class="settings-icon violet">A</div>
        <div class="settings-copy"><span class="eyebrow">Account</span><h2>{t('system.account')}</h2><p>{t('system.accountBody')}：<strong>{auth.username()}</strong>。</p></div>
        <A href="/change-password" class="secondary-button">{t('system.changeCredentials')}</A>
      </section>
      <section class="panel settings-card">
        <div class="settings-icon green">✓</div>
        <div class="settings-copy"><span class="eyebrow">Runtime</span><h2>{t('system.runtime')}</h2><p>{t('system.runtimeBody')}</p></div>
        <Show when={status()}><div class="version-box"><small>{t('system.version')}</small><strong>v{status()!.version}</strong><span><i/> {status()!.status}</span></div></Show>
      </section>
      <section class="panel settings-card wide">
        <div class="settings-icon orange">S</div>
        <div class="settings-copy"><span class="eyebrow">Security</span><h2>{t('system.security')}</h2><p>{t('system.securityBody')}</p></div>
        <a href="https://dash.cloudflare.com" target="_blank" class="secondary-button">{t('system.cloudflare')}</a>
      </section>
    </div>
  );
}
