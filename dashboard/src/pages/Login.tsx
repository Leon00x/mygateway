import { createSignal } from 'solid-js';
import { useAuth } from '../index';
import { Navigate, useNavigate } from '@solidjs/router';

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = createSignal('admin');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  if (auth.authenticated()) {
    return <Navigate href={auth.mustChangePassword() ? '/change-password' : '/'} />;
  }

  const handleLogin = async (event: Event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/admin/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username(), password: password() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? '登录失败');
      await auth.check();
      navigate(data.must_change_password ? '/change-password' : '/', { replace: true });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="login-page">
      <section class="login-visual">
        <div class="login-orb orb-one" /><div class="login-orb orb-two" />
        <div class="login-visual-copy">
          <div class="login-brand"><span class="brand-symbol">M</span><strong>MyGateway</strong></div>
          <span class="eyebrow light">AI AGGREGATION GATEWAY</span>
          <h1>一个入口，连接你的所有模型。</h1>
          <p>统一管理渠道、路由与密钥，在 Cloudflare 边缘安全转发每一次模型调用。</p>
          <div class="login-features"><span>固定优先级路由</span><span>响应前自动回退</span><span>流式 SSE 透传</span></div>
        </div>
      </section>
      <section class="login-panel">
        <form onSubmit={handleLogin} class="login-card">
          <span class="eyebrow">管理员控制台</span>
          <h2>欢迎回来</h2>
          <p>使用部署时生成的初始账号登录。</p>
          <div class="auth-form">
            <label>用户名<input value={username()} onInput={(e) => setUsername(e.currentTarget.value)} placeholder="用户名" autocomplete="username" required /></label>
            <label>密码<input type="password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} placeholder="密码" autocomplete="current-password" required /></label>
            {error() && <div class="form-error">{error()}</div>}
            <button type="submit" class="primary-button auth-submit" disabled={loading()}>{loading() ? '正在登录…' : '登录控制台'}</button>
          </div>
          <small class="login-hint">首次登录后系统会要求立即修改初始凭据。</small>
        </form>
      </section>
    </div>
  );
}
