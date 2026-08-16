import { A } from '@solidjs/router';
import { createSignal } from 'solid-js';
import { locale, toggleLocale } from '../i18n';
import './homepage.css';

const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/Leon00x/mygateway';
const GITHUB_URL = 'https://github.com/Leon00x/mygateway';

const copy = {
  zh: {
    badge: 'AI API GATEWAY',
    kicker: '开源、自托管的 AI 网关',
    title: '一个网关，调用所有 AI 模型',
    intro: '把 OpenAI、Anthropic、DeepSeek 等供应商接入一个地址，用统一 Key 调用。',
    detail: '部署在你自己的 Cloudflare。路由、密钥和用量数据都由你掌控。',
    deploy: '部署到 Cloudflare',
    local: '本地部署体验',
    console: '进入控制台',
    githubTab: 'GitHub 连接',
    commandTab: '部署命令',
    openSource: '开源 · MIT',
    docs: '开发文档',
  },
  en: {
    badge: 'AI API GATEWAY',
    kicker: 'Open-source, self-hosted AI gateway',
    title: 'Every AI model. One gateway.',
    intro: 'Connect OpenAI, Anthropic, DeepSeek, and more behind one endpoint and one key.',
    detail: 'Deploy to your Cloudflare account. Keep routing, keys, and usage data under your control.',
    deploy: 'Deploy to Cloudflare',
    local: 'Local deployment',
    console: 'Open console',
    githubTab: 'GitHub connection',
    commandTab: 'Deploy commands',
    openSource: 'Open source · MIT',
    docs: 'Developer docs',
  },
} as const;

export default function Homepage() {
  const c = () => copy[locale()];
  const [localTab, setLocalTab] = createSignal<'github' | 'command'>('github');

  const showLocalSetup = () => {
    setLocalTab('github');
    document.getElementById('local-setup')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div class="homepage">
      <img class="hp-backdrop" src="/homepage/hero-routing.png" alt="" fetchpriority="high" />
      <div class="hp-wash" />

      <header class="hp-header">
        <A href="/" class="hp-brand" aria-label="MyGateway homepage">
          <img src="/logo.png" alt="" />
          <strong>MyGateway</strong>
          <span>{c().badge}</span>
        </A>
        <div class="hp-header-actions">
          <button type="button" onClick={toggleLocale}>{locale() === 'zh' ? 'EN' : '中文'}</button>
          <A href="/console">{c().console}</A>
        </div>
      </header>

      <main class="hp-main">
        <section class="hp-copy">
          <p class="hp-kicker">{c().kicker}</p>
          <h1>{c().title}</h1>
          <div class="hp-description">
            <p>{c().intro}</p>
            <p>{c().detail}</p>
          </div>
          <div class="hp-actions">
            <a class="hp-primary" href={DEPLOY_URL} target="_blank" rel="noopener noreferrer">{c().deploy}</a>
            <button class="hp-secondary" type="button" onClick={showLocalSetup}>{c().local}</button>
          </div>
        </section>

        <section id="local-setup" class="hp-setup" aria-label={c().local}>
          <div class="hp-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={localTab() === 'github'}
              classList={{ active: localTab() === 'github' }}
              onClick={() => setLocalTab('github')}
            >
              {c().githubTab}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={localTab() === 'command'}
              classList={{ active: localTab() === 'command' }}
              onClick={() => setLocalTab('command')}
            >
              {c().commandTab}
            </button>
          </div>
          <div class="hp-setup-panel" role="tabpanel" aria-label={localTab() === 'github' ? c().githubTab : c().commandTab} />
        </section>
      </main>

      <footer class="hp-footer">
        <span>{c().openSource}</span>
        <nav>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="/v1/api-docs">{c().docs}</a>
        </nav>
      </footer>
    </div>
  );
}
