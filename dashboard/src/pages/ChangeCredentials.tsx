import { createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useAuth } from '../index';
import { t } from '../i18n';

export default function ChangeCredentials() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = createSignal(auth.username() || 'admin');
  const [currentPassword, setCurrentPassword] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setError('');
    if (newPassword() !== confirmPassword()) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/admin/api/auth/change-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username(),
          current_password: currentPassword(),
          new_password: newPassword(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? t('auth.changeFailed'));
      await auth.check();
      navigate('/', { replace: true });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="credential-page">
      <div class="credential-card">
        <div class="credential-mark">MG</div>
        <span class="eyebrow">{auth.mustChangePassword() ? t('auth.firstLogin') : t('auth.accountSecurity')}</span>
        <h1>{auth.mustChangePassword() ? t('auth.setupTitle') : t('auth.changeTitle')}</h1>
        <p>{auth.mustChangePassword() ? t('auth.setupBody') : t('auth.changeBody')}</p>
        <form onSubmit={submit} class="auth-form">
          <label>{t('auth.adminUsername')}<input value={username()} onInput={(e) => setUsername(e.currentTarget.value)} autocomplete="username" required /></label>
          <label>{t('auth.currentPassword')}<input type="password" value={currentPassword()} onInput={(e) => setCurrentPassword(e.currentTarget.value)} autocomplete="current-password" required /></label>
          <label>{t('auth.newPassword')}<input type="password" value={newPassword()} onInput={(e) => setNewPassword(e.currentTarget.value)} autocomplete="new-password" minlength="10" required /></label>
          <label>{t('auth.confirmPassword')}<input type="password" value={confirmPassword()} onInput={(e) => setConfirmPassword(e.currentTarget.value)} autocomplete="new-password" minlength="10" required /></label>
          {error() && <div class="form-error">{error()}</div>}
          <button class="primary-button auth-submit" type="submit" disabled={loading()}>{loading() ? t('auth.saving') : t('auth.saveAndEnter')}</button>
        </form>
      </div>
    </div>
  );
}
