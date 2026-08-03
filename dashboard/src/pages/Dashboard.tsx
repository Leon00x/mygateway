import { createSignal, onMount, Show, For } from 'solid-js';

interface UsageOverview {
  requests: number;
  successes: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  usage_unknown: number;
}

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  status: string;
}

interface Channel {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  status: string;
}

interface ModelItem {
  id: string;
  unified_model_id: string;
  display_name: string;
  status: string;
}

export default function Dashboard() {
  const [overview, setOverview] = createSignal<UsageOverview | null>(null);
  const [range, setRange] = createSignal<'today' | '7d' | '30d'>('today');
  const [loading, setLoading] = createSignal(true);
  const [keys, setKeys] = createSignal<ApiKey[]>([]);
  const [models, setModels] = createSignal<ModelItem[]>([]);
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [copied, setCopied] = createSignal('');

  const baseUrl = () => `${window.location.origin}/v1`;

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usageResp, keysResp, modelsResp, channelsResp] = await Promise.all([
        fetch(`/admin/api/usage/overview?range=${range()}`),
        fetch('/admin/api/keys'),
        fetch('/admin/api/models'),
        fetch('/admin/api/channels'),
      ]);
      if (usageResp.ok) setOverview(await usageResp.json());
      if (keysResp.ok) setKeys(await keysResp.json());
      if (modelsResp.ok) setModels((await modelsResp.json()).map((m: any) => m));
      if (channelsResp.ok) setChannels(await channelsResp.json());
    } catch {}
    setLoading(false);
  };

  onMount(fetchData);

  const handleRangeChange = (r: 'today' | '7d' | '30d') => {
    setRange(r);
    fetchData();
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const fmt = (n: number) => n.toLocaleString();
  const activeKeys = () => keys().filter((k) => k.status === 'active');
  const activeModels = () => models().filter((m) => m.status === 'active');
  const activeChannels = () => channels().filter((c) => c.status === 'active');

  return (
    <div>
      {/* ---- Endpoint Card ---- */}
      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5 mb-6">
        <h3 class="text-sm font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Gateway Endpoint</h3>

        <div class="flex items-center gap-2 mb-4">
          <code class="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono select-all break-all">
            {baseUrl()}
          </code>
          <button
            onClick={() => copy(baseUrl(), 'url')}
            class="shrink-0 px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs text-[var(--color-muted)] hover:text-white hover:border-[var(--color-primary)]"
          >
            {copied() === 'url' ? '✓' : 'Copy'}
          </button>
        </div>

        {/* Providers */}
        <Show when={activeChannels().length > 0}>
          <p class="text-xs text-[var(--color-muted)] mb-2">Providers</p>
          <div class="flex flex-wrap gap-2 mb-3">
            <For each={activeChannels()}>
              {(ch) => (
                <span class="inline-flex items-center gap-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2.5 py-1 text-xs">
                  <span class="font-medium">{ch.name}</span>
                  <span class="text-[var(--color-muted)] font-mono">{ch.base_url.replace('https://', '').split('/')[0]}</span>
                </span>
              )}
            </For>
          </div>
        </Show>

        {/* API Keys */}
        <Show when={activeKeys().length > 0}>
          <p class="text-xs text-[var(--color-muted)] mb-2">API Keys</p>
          <div class="space-y-1.5">
            <For each={activeKeys()}>
              {(key) => (
                <div class="flex items-center gap-2">
                  <span class="text-xs text-[var(--color-muted)] w-20 shrink-0 truncate" title={key.name}>{key.name}</span>
                  <code class="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-1 text-xs font-mono select-all">
                    {key.key_prefix}••••••••
                  </code>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Models */}
        <Show when={activeModels().length > 0}>
          <p class="text-xs text-[var(--color-muted)] mt-3 mb-2">Available Models</p>
          <div class="flex flex-wrap gap-2">
            <For each={activeModels()}>
              {(model) => (
                <span class="inline-block bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2.5 py-1 text-xs font-mono">
                  {model.unified_model_id}
                </span>
              )}
            </For>
          </div>
        </Show>

        {/* Quick Start curl */}
        <Show when={activeKeys().length > 0 && activeModels().length > 0}>
          <div class="mt-4 pt-4 border-t border-[var(--color-border)]">
            <p class="text-xs text-[var(--color-muted)] mb-2">Quick Start</p>
            <div class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2.5">
              <pre class="text-xs font-mono text-[var(--color-muted)] whitespace-pre-wrap break-all">{`curl ${baseUrl()}/chat/completions \\
  -H "Authorization: Bearer ${activeKeys()[0]?.key_prefix}••••" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${activeModels()[0]?.unified_model_id}", "messages": [{"role": "user", "content": "hello"}]}'`}</pre>
            </div>
            <button
              onClick={() => copy(
                `curl ${baseUrl()}/chat/completions \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${activeModels()[0]?.unified_model_id}", "messages": [{"role": "user", "content": "hello"}]}'`,
                'curl'
              )}
              class="mt-2 px-3 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs text-[var(--color-muted)] hover:text-white"
            >
              {copied() === 'curl' ? '✓ Copied' : 'Copy curl'}
            </button>
          </div>
        </Show>
      </div>

      {/* ---- Usage Stats ---- */}
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold text-[var(--color-muted)] uppercase tracking-wider">Usage</h3>
        <div class="flex gap-2">
          {(['today', '7d', '30d'] as const).map((r) => (
            <button
              onClick={() => handleRangeChange(r)}
              class={`px-3 py-1 rounded text-xs ${range() === r ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] text-[var(--color-muted)] border border-[var(--color-border)]'}`}
            >
              {r === 'today' ? 'Today' : r === '7d' ? '7 Days' : '30 Days'}
            </button>
          ))}
        </div>
      </div>

      {loading() && <p class="text-sm text-[var(--color-muted)]">Loading...</p>}

      <Show when={overview()}>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Requests" value={fmt(overview()!.requests)} />
          <StatCard label="Success" value={fmt(overview()!.successes)} />
          <StatCard label="Errors" value={fmt(overview()!.errors)} />
          <StatCard label="Input Tokens" value={fmt(overview()!.input_tokens)} />
          <StatCard label="Output Tokens" value={fmt(overview()!.output_tokens)} />
          <StatCard label="Usage Unknown" value={fmt(overview()!.usage_unknown)} />
        </div>
      </Show>
    </div>
  );
}

function StatCard(props: { label: string; value: string }) {
  return (
    <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
      <p class="text-xs text-[var(--color-muted)] mb-1">{props.label}</p>
      <p class="text-2xl font-bold">{props.value}</p>
    </div>
  );
}
