/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route, Navigate } from '@solidjs/router';
import { createContext, useContext, createSignal, Show, onMount } from 'solid-js';
import './app.css';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import Models from './pages/Models';
import ApiKeys from './pages/ApiKeys';
import System from './pages/System';

// --- Auth context ---
const AuthContext = createContext<{
  authenticated: () => boolean;
  check: () => Promise<void>;
  logout: () => Promise<void>;
}>();

export function useAuth() {
  return useContext(AuthContext)!;
}

function AuthProvider(props: { children: JSX.Element }) {
  const [authenticated, setAuthenticated] = createSignal(false);
  const [checking, setChecking] = createSignal(true);

  const check = async () => {
    try {
      const r = await fetch('/admin/api/auth/session');
      setAuthenticated(r.ok);
    } catch {
      setAuthenticated(false);
    }
    setChecking(false);
  };

  const logout = async () => {
    await fetch('/admin/api/auth/logout', { method: 'POST' });
    setAuthenticated(false);
  };

  onMount(check);

  return (
    <AuthContext.Provider value={{ authenticated, check, logout }}>
      <Show when={!checking()} fallback={
        <div class="min-h-screen flex items-center justify-center">
          <p class="text-[var(--color-muted)]">...</p>
        </div>
      }>
        {props.children}
      </Show>
    </AuthContext.Provider>
  );
}

function RequireAuth(props: { children: JSX.Element }) {
  const auth = useAuth();
  return (
    <Show when={auth.authenticated()} fallback={<Navigate href="/login" />}>
      {props.children}
    </Show>
  );
}

// --- App shell ---
function AppLayout(props: { children?: JSX.Element }) {
  const auth = useAuth();
  return (
    <div class="min-h-screen">
      <nav class="border-b border-[var(--color-border)] px-6 py-3 flex items-center gap-6">
        <h1 class="text-lg font-bold text-[var(--color-primary)]">MyGateway</h1>
        <Show when={auth.authenticated()}>
          <a href="/" class="text-sm text-[var(--color-muted)] hover:text-white">Dashboard</a>
          <a href="/channels" class="text-sm text-[var(--color-muted)] hover:text-white">Channels</a>
          <a href="/models" class="text-sm text-[var(--color-muted)] hover:text-white">Models</a>
          <a href="/keys" class="text-sm text-[var(--color-muted)] hover:text-white">API Keys</a>
          <a href="/system" class="text-sm text-[var(--color-muted)] hover:text-white">System</a>
          <div class="flex-1" />
          <button onClick={auth.logout} class="text-sm text-[var(--color-muted)] hover:text-red-400">Logout</button>
        </Show>
      </nav>
      <main class="p-6">{props.children}</main>
    </div>
  );
}

render(
  () => (
    <AuthProvider>
      <Router root={AppLayout}>
        <Route path="/login" component={Login} />
        <Route path="/" component={() => <RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/channels" component={() => <RequireAuth><Channels /></RequireAuth>} />
        <Route path="/models" component={() => <RequireAuth><Models /></RequireAuth>} />
        <Route path="/keys" component={() => <RequireAuth><ApiKeys /></RequireAuth>} />
        <Route path="/system" component={() => <RequireAuth><System /></RequireAuth>} />
      </Router>
    </AuthProvider>
  ),
  document.getElementById('root')!,
);
