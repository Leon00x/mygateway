import { createSignal, onMount } from 'solid-js';

export default function System() {
  const [status, setStatus] = createSignal<{ version: string; status: string } | null>(null);

  onMount(async () => {
    try {
      const resp = await fetch('/admin/api/system/status');
      if (resp.ok) setStatus(await resp.json());
    } catch {}
  });

  return (
    <div>
      <h2 class="text-xl font-bold mb-6">System</h2>
      {status() && (
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 space-y-2">
          <p class="text-sm"><span class="text-[var(--color-muted)]">Version:</span> {status()!.version}</p>
          <p class="text-sm"><span class="text-[var(--color-muted)]">Status:</span> {status()!.status}</p>
        </div>
      )}
    </div>
  );
}
