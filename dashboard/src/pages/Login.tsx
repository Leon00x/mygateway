import { createSignal } from 'solid-js';
import { useAuth } from '../index';
import {Navigate, useNavigate } from '@solidjs/router';

export default function Login() {
  const auth = useAuth();
  const nav = useNavigate();
  const [token, setToken] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  // Already logged in? Redirect away
  if (auth.authenticated()) {
    return <Navigate href="/" />;
  }

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const resp = await fetch('/admin/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token() }),
      });
      if (resp.ok) {
        await auth.check();
        nav('/', { replace: true });
      } else {
        const data = await resp.json();
        setError(data.error?.message ?? 'Login failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="max-w-sm mx-auto mt-20">
      <h2 class="text-xl font-bold mb-2">MyGateway</h2>
      <p class="text-sm text-[var(--color-muted)] mb-6">输入管理员 Token 登录</p>
      <form onSubmit={handleLogin}>
        <input
          type="password"
          value={token()}
          onInput={(e) => setToken(e.currentTarget.value)}
          placeholder="Admin Token"
          class="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm mb-4 focus:border-[var(--color-primary)] outline-none"
        />
        {error() && <p class="text-red-400 text-sm mb-4">{error()}</p>}
        <button
          type="submit"
          disabled={loading()}
          class="w-full py-2 bg-[var(--color-primary)] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading() ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}
