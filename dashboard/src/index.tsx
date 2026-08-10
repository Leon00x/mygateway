/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route, Navigate, A, useLocation } from '@solidjs/router';
import { createContext, useContext, createSignal, createEffect, Show, onMount, onCleanup, For, type JSX } from 'solid-js';
import './app.css';
import Login from './pages/Login';
import ChangeCredentials from './pages/ChangeCredentials';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import Models from './pages/Models';
import ApiKeys from './pages/ApiKeys';
import AnalyticsUsage from './pages/AnalyticsUsage';
import AnalyticsLogs from './pages/AnalyticsLogs';
import System from './pages/System';
import Icon, { IconName } from './components/Icon';
import { t, locale, toggleLocale } from './i18n';

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
      <Show when={!checking()} fallback={<div class="app-loading"><img class="brand-logo" src="/logo.png" alt="MyGateway" /><span>正在加载控制台…</span></div>}>
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

interface NavigationItem {
  href: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const navigationSections: { label?: string; icon?: IconName; nested?: boolean; collapsible?: boolean; items: NavigationItem[] }[] = [
  {
    items: [
      { href: '/', label: 'nav.overview', icon: 'home', end: true },
      { href: '/channels', label: 'nav.channels', icon: 'channels' },
      { href: '/models', label: 'nav.models', icon: 'models' },
      { href: '/keys', label: 'nav.keys', icon: 'keys' },
    ],
  },
  {
    label: 'nav.analytics',
    icon: 'analytics-folder',
    nested: true,
    collapsible: true,
    items: [
      { href: '/analytics/usage', label: 'nav.analyticsUsage', icon: 'analytics' },
      { href: '/analytics/logs', label: 'nav.analyticsLogs', icon: 'requests' },
    ],
  },
  { items: [{ href: '/system', label: 'nav.system', icon: 'system' }] },
];

const titles: Record<string, string> = {
  '/': 'title.overview',
  '/channels': 'title.channels',
  '/models': 'title.models',
  '/keys': 'title.keys',
  '/analytics/usage': 'title.usage',
  '/analytics/logs': 'title.logs',
  '/requests': 'title.logs',
  '/system': 'title.system',
};

const startupTheme = readThemePreference();
document.documentElement.dataset.theme = startupTheme;

function AppLayout(props: { children?: JSX.Element }) {
  const auth = useAuth();
  const location = useLocation();
  const pageTitle = () => t(titles[location.pathname] ?? titles['/']);
  const [theme, setTheme] = createSignal<'light' | 'dark'>(startupTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(readSidebarPreference());
  const [analyticsExpanded, setAnalyticsExpanded] = createSignal(true);

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

  // Keep <html lang> in sync with the active locale (a11y; index.html defaults to en).
  createEffect(() => {
    document.documentElement.lang = locale() === 'zh' ? 'zh-CN' : 'en';
  });

  return (
    <Show when={auth.authenticated()} fallback={<main class="public-shell">{props.children}<button class="theme-toggle lang-toggle public-lang-toggle" aria-label="Switch language" title="中 / EN" onClick={() => toggleLocale()}>{locale() === 'zh' ? 'EN' : '中文'}</button><ThemeToggle theme={theme()} onToggle={toggleTheme} public /></main>}>
      <div class="app-shell" classList={{ 'sidebar-collapsed': sidebarCollapsed() }}>
        <aside class="sidebar">
          <A href="/" class="brand">
            <img class="brand-logo" src="/logo.png" alt="MyGateway" />
            <span><strong>MyGateway</strong></span>
          </A>
          <nav class="sidebar-nav">
            <For each={navigationSections}>{(section) => (
              <section class="nav-section" classList={{
                'nav-section-nested': Boolean(section.nested),
                'nav-section-closed': Boolean(section.collapsible && !analyticsExpanded()),
              }}>
                <Show when={section.icon && section.label} fallback={
                  <Show when={section.label}><div class="nav-section-label">{t(section.label!)}</div></Show>
                }>
                  <button
                    type="button"
                    class="nav-module-heading"
                    classList={{ 'module-active': section.items.some((item) => location.pathname.startsWith(item.href)) }}
                    aria-expanded={analyticsExpanded()}
                    onClick={() => setAnalyticsExpanded(!analyticsExpanded())}
                  >
                    <Icon name={section.icon!} size={18} />
                    <strong>{t(section.label!)}</strong>
                    <span class="nav-module-caret" aria-hidden="true" />
                  </button>
                </Show>
                <div class="nav-section-items">
                  <For each={section.items}>{(item) => (
                    <A href={item.href} end={item.end} class="nav-item" activeClass="active" title={sidebarCollapsed() ? t(item.label) : undefined}>
                      <Icon name={item.icon} size={18} />
                      <span><strong>{t(item.label)}</strong></span>
                    </A>
                  )}</For>
                </div>
              </section>
            )}</For>
          </nav>
          <div class="sidebar-bottom">
            <a href="/v1/api-docs" target="_blank" class="nav-item compact" title={sidebarCollapsed() ? t('nav.docs') : undefined}><Icon name="docs" size={18} /><span><strong>{t('nav.docs')}</strong></span></a>
            <button class="sidebar-toggle" aria-label={sidebarCollapsed() ? t('common.expand') : t('common.collapse')} title={sidebarCollapsed() ? t('common.expand') : t('common.collapse')} onClick={toggleSidebar}>
              <Icon name={sidebarCollapsed() ? 'panel-expand' : 'panel-collapse'} size={18} />
            </button>
          </div>
        </aside>
        <section class="workspace">
          <header class="topbar">
            <h1>{pageTitle()}</h1>
            <div class="topbar-actions">
              <a class="ghost-button" href="/v1/api-docs" target="_blank"><Icon name="docs" size={16} /> {t('nav.docs')}</a>
              <span class="status-pill"><i /> {t('status.online')}</span>
              <button class="theme-toggle lang-toggle" aria-label="Switch language" title="中 / EN" onClick={() => toggleLocale()}>
                {locale() === 'zh' ? 'EN' : '中文'}
              </button>
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
      <Route path="/requests" component={() => <RequireReady><Navigate href="/analytics/logs" /></RequireReady>} />
      <Route path="/analytics/usage" component={() => <RequireReady><AnalyticsUsage /></RequireReady>} />
      <Route path="/analytics/logs" component={() => <RequireReady><AnalyticsLogs /></RequireReady>} />
      <Route path="/system" component={() => <RequireReady><System /></RequireReady>} />
    </Router>
  </AuthProvider>
), document.getElementById('root')!);
