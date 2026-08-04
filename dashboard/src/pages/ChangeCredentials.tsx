import { createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useAuth } from '../index';

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
      setError('两次输入的新密码不一致');
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
      if (!response.ok) throw new Error(data.error?.message ?? '修改失败');
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
        <span class="eyebrow">{auth.mustChangePassword() ? '首次登录' : '账号安全'}</span>
        <h1>{auth.mustChangePassword() ? '设置你的管理员账号' : '修改管理员凭据'}</h1>
        <p>{auth.mustChangePassword() ? '初始凭据仅用于完成部署。继续前请设置新的用户名和密码。' : '修改后，其他已登录的管理会话将立即失效。'}</p>
        <form onSubmit={submit} class="auth-form">
          <label>管理员用户名<input value={username()} onInput={(e) => setUsername(e.currentTarget.value)} autocomplete="username" required /></label>
          <label>当前初始密码<input type="password" value={currentPassword()} onInput={(e) => setCurrentPassword(e.currentTarget.value)} autocomplete="current-password" required /></label>
          <label>新密码<input type="password" value={newPassword()} onInput={(e) => setNewPassword(e.currentTarget.value)} autocomplete="new-password" minlength="10" required /></label>
          <label>确认新密码<input type="password" value={confirmPassword()} onInput={(e) => setConfirmPassword(e.currentTarget.value)} autocomplete="new-password" minlength="10" required /></label>
          {error() && <div class="form-error">{error()}</div>}
          <button class="primary-button auth-submit" type="submit" disabled={loading()}>{loading() ? '正在保存…' : '保存并进入控制台'}</button>
        </form>
      </div>
    </div>
  );
}
