/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route, Navigate, A, useLocation } from '@solidjs/router';
import { createContext, useContext, createSignal, Show, onMount, onCleanup, For } from 'solid-js';
import './app.css';
import Login from './pages/Login';
import ChangeCredentials from './pages/ChangeCredentials';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import Models from './pages/Models';
import ApiKeys from './pages/ApiKeys';
import Requests from './pages/Requests';
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

const navigation: { href: string; label: string; icon: IconName; end?: boolean }[] = [
  { href: '/', label: '概览', icon: 'home', end: true },
  { href: '/channels', label: '渠道', icon: 'channels' },
  { href: '/models', label: '模型', icon: 'models' },
  { href: '/keys', label: 'API 密钥', icon: 'keys' },
  { href: '/requests', label: '请求日志', icon: 'requests' },
  { href: '/system', label: '系统设置', icon: 'system' },
];

const titles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: '控制台概览', subtitle: '查看网关状态、资源配置和调用数据' },
  '/channels': { title: '渠道管理', subtitle: '连接并管理 OpenAI Compatible 模型服务' },
  '/models': { title: '模型路由', subtitle: '配置统一模型、渠道实例和故障回退顺序' },
  '/keys': { title: 'API 密钥', subtitle: '创建和管理调用 MyGateway 的访问凭据' },
  '/requests': { title: '请求日志', subtitle: '查看最近调用的用量、费用与状态' },
  '/system': { title: '系统设置', subtitle: '查看运行状态并维护管理员账号' },
};

const startupTheme = readThemePreference();
document.documentElement.dataset.theme = startupTheme;

function AppLayout(props: { children?: JSX.Element }) {
  const auth = useAuth();
  const location = useLocation();
  const page = () => titles[location.pathname] ?? titles['/'];
  const [theme, setTheme] = createSignal<'light' | 'dark'>(startupTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(readSidebarPreference());

  const applyTheme = (next: 'light' | 'dark') => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('mygateway.theme', next); } catch { /* storage may be unavailable */ }
  };

  const toggleTheme = () => applyTheme(theme() === 'light' ? 'dark' : 'light');
  const toggleSidebar = () => {
    const next = !sidebarCollapsed();
    setSidebarCollapsed(next);
    try { localStorage.setItem('mygateway.sidebarCollapsed', String(next)); } catch { /* storage may be unavailable */ }
  };

  onMount(() => { document.documentElement.dataset.theme = theme(); });

  return (
    <Show when={auth.authenticated()} fallback={<main class="public-shell">{props.children}<ThemeToggle theme={theme()} onToggle={toggleTheme} public /></main>}>
      <div class="app-shell" classList={{ 'sidebar-collapsed': sidebarCollapsed() }}>
        <aside class="sidebar">
          <A href="/" class="brand">
            <span class="brand-symbol">M</span>
            <span><strong>MyGateway</strong><small>AI ROUTER</small></span>
          </A>
          <nav class="sidebar-nav">
            <For each={navigation}>{(item) => (
              <A href={item.href} end={item.end} class="nav-item" activeClass="active" title={sidebarCollapsed() ? item.label : undefined}>
                <Icon name={item.icon} size={19} />
                <span><strong>{item.label}</strong></span>
              </A>
            )}</For>
          </nav>
          <div class="sidebar-bottom">
            <a href="/v1/api-docs" target="_blank" class="nav-item compact" title={sidebarCollapsed() ? '接口文档' : undefined}><Icon name="docs" size={18} /><span><strong>接口文档</strong></span></a>
            <button class="sidebar-toggle" aria-label={sidebarCollapsed() ? '展开侧边栏' : '收起侧边栏'} title={sidebarCollapsed() ? '展开侧边栏' : '收起侧边栏'} onClick={toggleSidebar}>
              <Icon name={sidebarCollapsed() ? 'panel-expand' : 'panel-collapse'} size={18} />
            </button>
          </div>
        </aside>
        <section class="workspace">
          <header class="topbar">
            <div><h1>{page().title}</h1><p>{page().subtitle}</p></div>
            <div class="topbar-actions">
              <a class="ghost-button" href="/v1/api-docs" target="_blank"><Icon name="docs" size={16} /> API Docs</a>
              <span class="status-pill"><i /> Gateway Online</span>
              <ThemeToggle theme={theme()} onToggle={toggleTheme} />
              <UserMenu username={auth.username()} onLogout={auth.logout} />
            </div>
          </header>
          <main class="page-content">{props.children}</main>
        </section>
      </div>
    </Show>
  );
}

function readThemePreference(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('mygateway.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage may be unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readSidebarPreference(): boolean {
  try { return localStorage.getItem('mygateway.sidebarCollapsed') === 'true'; }
  catch { return false; }
}

function ThemeToggle(props: { theme: 'light' | 'dark'; onToggle: () => void; public?: boolean }) {
  const label = () => props.theme === 'light' ? '切换到暗黑模式' : '切换到浅色模式';
  return <button class="theme-toggle" classList={{ 'public-theme-toggle': Boolean(props.public) }} aria-label={label()} title={label()} aria-pressed={props.theme === 'dark'} onClick={props.onToggle}>
    <Icon name={props.theme === 'light' ? 'moon' : 'sun'} size={18} />
  </button>;
}

function UserMenu(props: { username: string; onLogout: () => Promise<void> }) {
  let menu!: HTMLDetailsElement;
  const close = () => menu.removeAttribute('open');

  onMount(() => {
    const closeFromOutside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) close();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    onCleanup(() => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    });
  });

  return <details class="user-menu" ref={menu}>
    <summary role="button" aria-haspopup="menu" aria-label={`管理员菜单：${props.username}`} title={props.username}>
      <span class="avatar topbar-avatar">{props.username.slice(0, 1).toUpperCase()}</span>
    </summary>
    <div class="user-menu-panel" role="menu">
      <div class="user-menu-head">
        <span class="avatar">{props.username.slice(0, 1).toUpperCase()}</span>
        <span><strong>{props.username}</strong><small>管理员</small></span>
      </div>
      <A href="/system" class="user-menu-item" role="menuitem" onClick={close}><Icon name="system" size={17} />系统设置</A>
      <A href="/change-password" class="user-menu-item" role="menuitem" onClick={close}><Icon name="keys" size={17} />修改登录凭据</A>
      <button class="user-menu-item danger" role="menuitem" onClick={() => { close(); void props.onLogout(); }}><Icon name="logout" size={17} />退出登录</button>
    </div>
  </details>;
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
      <Route path="/requests" component={() => <RequireReady><Requests /></RequireReady>} />
      <Route path="/system" component={() => <RequireReady><System /></RequireReady>} />
    </Router>
  </AuthProvider>
), document.getElementById('root')!);
