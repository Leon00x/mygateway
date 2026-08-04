/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route, Navigate, A, useLocation } from '@solidjs/router';
import { createContext, useContext, createSignal, Show, onMount, For } from 'solid-js';
import './app.css';
import Login from './pages/Login';
import ChangeCredentials from './pages/ChangeCredentials';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import Models from './pages/Models';
import ApiKeys from './pages/ApiKeys';
import System from './pages/System';
import Icon, { IconName } from './components/Icon';

interface AuthState {
  authenticated: () => boolean;
  username: () => string;
  mustChangePassword: () => boolean;
  check: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>();

export function useAuth() {
  return useContext(AuthContext)!;
}

function AuthProvider(props: { children: JSX.Element }) {
  const [authenticated, setAuthenticated] = createSignal(false);
  const [username, setUsername] = createSignal('');
  const [mustChangePassword, setMustChangePassword] = createSignal(false);
  const [checking, setChecking] = createSignal(true);

  const check = async () => {
    try {
      const response = await fetch('/admin/api/auth/session');
      if (!response.ok) throw new Error('No session');
      const data = await response.json();
      setAuthenticated(true);
      setUsername(data.username ?? 'admin');
      setMustChangePassword(Boolean(data.must_change_password));
    } catch {
      setAuthenticated(false);
      setUsername('');
      setMustChangePassword(false);
    } finally {
      setChecking(false);
    }
  };

  const logout = async () => {
    await fetch('/admin/api/auth/logout', { method: 'POST' });
    setAuthenticated(false);
    setUsername('');
  };

  onMount(check);

  return (
    <AuthContext.Provider value={{ authenticated, username, mustChangePassword, check, logout }}>
      <Show when={!checking()} fallback={<div class="app-loading"><div class="brand-symbol">M</div><span>正在加载控制台…</span></div>}>
        {props.children}
      </Show>
    </AuthContext.Provider>
  );
}

function RequireAuth(props: { children: JSX.Element }) {
  const auth = useAuth();
  return <Show when={auth.authenticated()} fallback={<Navigate href="/login" />}>{props.children}</Show>;
}

function RequireReady(props: { children: JSX.Element }) {
  const auth = useAuth();
  if (!auth.authenticated()) return <Navigate href="/login" />;
  if (auth.mustChangePassword()) return <Navigate href="/change-password" />;
  return props.children;
}

const navigation: { href: string; label: string; detail: string; icon: IconName; end?: boolean }[] = [
  { href: '/', label: '概览', detail: 'Dashboard', icon: 'home', end: true },
  { href: '/channels', label: '渠道', detail: 'Providers', icon: 'channels' },
  { href: '/models', label: '模型', detail: 'Routing', icon: 'models' },
  { href: '/keys', label: 'API 密钥', detail: 'Access', icon: 'keys' },
  { href: '/system', label: '系统设置', detail: 'Settings', icon: 'system' },
];

const titles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: '控制台概览', subtitle: '查看网关状态、资源配置和调用数据' },
  '/channels': { title: '渠道管理', subtitle: '连接并管理 OpenAI Compatible 模型服务' },
  '/models': { title: '模型路由', subtitle: '配置统一模型、渠道实例和故障回退顺序' },
  '/keys': { title: 'API 密钥', subtitle: '创建和管理调用 MyGateway 的访问凭据' },
  '/system': { title: '系统设置', subtitle: '查看运行状态并维护管理员账号' },
};

function AppLayout(props: { children?: JSX.Element }) {
  const auth = useAuth();
  const location = useLocation();
  const page = () => titles[location.pathname] ?? titles['/'];

  return (
    <Show when={auth.authenticated()} fallback={<main class="public-shell">{props.children}</main>}>
      <div class="app-shell">
        <aside class="sidebar">
          <A href="/" class="brand">
            <span class="brand-symbol">M</span>
            <span><strong>MyGateway</strong><small>AI ROUTER</small></span>
          </A>
          <div class="sidebar-label">工作台</div>
          <nav class="sidebar-nav">
            <For each={navigation}>{(item) => (
              <A href={item.href} end={item.end} class="nav-item" activeClass="active">
                <Icon name={item.icon} size={19} />
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              </A>
            )}</For>
          </nav>
          <div class="sidebar-bottom">
            <a href="/v1/api-docs" target="_blank" class="nav-item compact"><Icon name="docs" size={18} /><span><strong>接口文档</strong></span></a>
            <div class="user-tile">
              <span class="avatar">{auth.username().slice(0, 1).toUpperCase()}</span>
              <span class="user-copy"><strong>{auth.username()}</strong><small>管理员</small></span>
              <button title="退出登录" onClick={auth.logout}><Icon name="logout" size={17} /></button>
            </div>
          </div>
        </aside>
        <section class="workspace">
          <header class="topbar">
            <div><h1>{page().title}</h1><p>{page().subtitle}</p></div>
            <div class="topbar-actions">
              <a class="ghost-button" href="/v1/api-docs" target="_blank"><Icon name="docs" size={16} /> API Docs</a>
              <span class="status-pill"><i /> Gateway Online</span>
            </div>
          </header>
          <main class="page-content">{props.children}</main>
        </section>
      </div>
    </Show>
  );
}

render(() => (
  <AuthProvider>
    <Router root={AppLayout}>
      <Route path="/login" component={Login} />
      <Route path="/change-password" component={() => <RequireAuth><ChangeCredentials /></RequireAuth>} />
      <Route path="/" component={() => <RequireReady><Dashboard /></RequireReady>} />
      <Route path="/channels" component={() => <RequireReady><Channels /></RequireReady>} />
      <Route path="/models" component={() => <RequireReady><Models /></RequireReady>} />
      <Route path="/keys" component={() => <RequireReady><ApiKeys /></RequireReady>} />
      <Route path="/system" component={() => <RequireReady><System /></RequireReady>} />
    </Router>
  </AuthProvider>
), document.getElementById('root')!);
