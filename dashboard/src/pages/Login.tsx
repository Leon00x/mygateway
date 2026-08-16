import { createSignal } from 'solid-js';
import { useAuth } from '../index';
import { Navigate, useNavigate } from '@solidjs/router';
import { t } from '../i18n';

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = createSignal('admin');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  if (auth.authenticated()) {
    return <Navigate href={auth.mustChangePassword() ? '/change-password' : '/console'} />;
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
      if (!response.ok) throw new Error(data.error?.message ?? t('auth.loginFailed'));
      await auth.check();
      navigate(data.must_change_password ? '/change-password' : '/console', { replace: true });
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
          <div class="login-brand"><img class="brand-logo" src="/logo.png" alt="MyGateway" /><strong>MyGateway</strong></div>
          <span class="eyebrow light">AI AGGREGATION GATEWAY</span>
          <h1>{t('auth.tagline1')}</h1>
          <p>{t('auth.tagline2')}</p>
          <div class="login-features"><span>{t('auth.featureSimple')}</span><span>{t('auth.featureFree')}</span><span>{t('auth.featureCost')}</span></div>
        </div>
      </section>
      <section class="login-panel">
        <form onSubmit={handleLogin} class="login-card">
          <span class="eyebrow">{t('auth.eyebrowAdmin')}</span>
          <h2>{t('auth.loginTitle')}</h2>
          <p>{t('auth.loginSub')}</p>
          <div class="auth-form">
            <label>{t('auth.username')}<input value={username()} onInput={(e) => setUsername(e.currentTarget.value)} placeholder={t('auth.username')} autocomplete="username" required /></label>
            <label>{t('auth.password')}<input type="password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} placeholder={t('auth.password')} autocomplete="current-password" required /></label>
            {error() && <div class="form-error">{error()}</div>}
            <button type="submit" class="primary-button auth-submit" disabled={loading()}>{loading() ? t('auth.loading') : t('auth.login')}</button>
          </div>
          <small class="login-hint">{t('auth.mustChange')}</small>
        </form>
      </section>
    </div>
  );
}
