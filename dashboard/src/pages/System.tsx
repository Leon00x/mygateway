import { createSignal, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { useAuth } from '../index';

export default function System() {
  const auth = useAuth();
  const [status, setStatus] = createSignal<{ version: string; status: string } | null>(null);
  onMount(async () => { try { const response = await fetch('/admin/api/system/status'); if (response.ok) setStatus(await response.json()); } catch {} });

  return (
    <div class="settings-grid">
      <section class="panel settings-card">
        <div class="settings-icon violet">A</div>
        <div class="settings-copy"><span class="eyebrow">Account</span><h2>管理员账号</h2><p>当前登录用户：<strong>{auth.username()}</strong>。定期更新密码可以降低管理入口风险。</p></div>
        <A href="/change-password" class="secondary-button">修改用户名与密码</A>
      </section>
      <section class="panel settings-card">
        <div class="settings-icon green">✓</div>
        <div class="settings-copy"><span class="eyebrow">Runtime</span><h2>Worker 状态</h2><p>Cloudflare Worker、静态资源和管理 API 当前运行正常。</p></div>
        <Show when={status()}><div class="version-box"><small>VERSION</small><strong>v{status()!.version}</strong><span><i/> {status()!.status}</span></div></Show>
      </section>
      <section class="panel settings-card wide">
        <div class="settings-icon orange">S</div>
        <div class="settings-copy"><span class="eyebrow">Security</span><h2>密钥保护</h2><p>Provider Key 使用 MASTER_KEY 进行 AES-256-GCM 加密。MASTER_KEY 在首次部署时生成并保存为 Cloudflare Secret，不能随意轮换。</p></div>
        <a href="https://dash.cloudflare.com" target="_blank" class="secondary-button">Cloudflare Dashboard ↗</a>
      </section>
    </div>
  );
}
